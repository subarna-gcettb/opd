const { pool, withTransaction } = require('../config/database');
const sequenceService = require('./sequenceService');
const healthIdService = require('./healthIdService');
const aadhaarUtil = require('../utils/aadhaarUtil');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

/** Registration Number format: REG-YY-BB-NNNNNN */
async function generateRegistrationNumber(conn, branchCode, at = new Date()) {
  const yy = String(at.getFullYear()).slice(-2);
  const bb = String(branchCode).padStart(2, '0').slice(-2);
  const seq = await sequenceService.nextValue(conn, `regno:${yy}:${bb}`);
  return `REG${yy}${bb}${sequenceService.pad(seq, 6)}`;
}

/**
 * Registers a new patient. Wraps patient + address + medical profile +
 * registration number + Health ID generation in a single transaction.
 * On a (rare) Health ID collision the whole transaction is retried.
 */
async function registerPatient(payload, actorUserId) {
  const MAX_ATTEMPTS = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await withTransaction(async (conn) => {
        const [[branch]] = await conn.execute('SELECT code FROM branches WHERE id = :id AND is_active = 1', {
          id: payload.branchId
        });
        if (!branch) throw new AppError('Invalid branch', 422);

        const healthId = await healthIdService.generateHealthId(conn, branch.code);
        const registrationNumber = await generateRegistrationNumber(conn, branch.code);

        let aadhaarEncrypted = null;
        let aadhaarIv = null;
        let aadhaarHash = null;
        let aadhaarLast4 = null;
        if (payload.aadhaar) {
          if (!aadhaarUtil.isValid(payload.aadhaar)) throw new AppError('Aadhaar number must be 12 digits', 422);
          const enc = aadhaarUtil.encrypt(payload.aadhaar);
          aadhaarEncrypted = enc.encrypted;
          aadhaarIv = enc.iv;
          aadhaarHash = aadhaarUtil.hash(payload.aadhaar);
          aadhaarLast4 = aadhaarUtil.last4(payload.aadhaar);

          const [dupe] = await conn.execute(
            'SELECT id, health_id, name FROM patients WHERE aadhaar_hash = :hash AND deleted_at IS NULL LIMIT 1',
            { hash: aadhaarHash }
          );
          if (dupe.length) {
            throw new AppError(
              `A patient with this Aadhaar is already registered (Health ID ${dupe[0].health_id}). Use patient search instead.`,
              409
            );
          }
        }

        const [result] = await conn.execute(
          `INSERT INTO patients
            (health_id, registration_number, branch_id, name, father_name, husband_name, gender, dob, age_years,
             mobile, alt_mobile, email, aadhaar_encrypted, aadhaar_iv, aadhaar_hash, aadhaar_last4, created_by)
           VALUES
            (:healthId, :registrationNumber, :branchId, :name, :fatherName, :husbandName, :gender, :dob, :ageYears,
             :mobile, :altMobile, :email, :aadhaarEncrypted, :aadhaarIv, :aadhaarHash, :aadhaarLast4, :createdBy)`,
          {
            healthId,
            registrationNumber,
            branchId: payload.branchId,
            name: payload.name,
            fatherName: payload.fatherName || null,
            husbandName: payload.husbandName || null,
            gender: payload.gender,
            dob: payload.dob || null,
            ageYears: payload.ageYears || null,
            mobile: payload.mobile,
            altMobile: payload.altMobile || null,
            email: payload.email ? payload.email.trim().toLowerCase() : null,
            aadhaarEncrypted,
            aadhaarIv,
            aadhaarHash,
            aadhaarLast4,
            createdBy: actorUserId
          }
        );
        const patientId = result.insertId;

        await conn.execute(
          `INSERT INTO patient_addresses (patient_id, address, village_town, police_station, district, state, pin_code)
           VALUES (:patientId, :address, :village, :ps, :district, :state, :pin)`,
          {
            patientId,
            address: payload.address || null,
            village: payload.villageTown || null,
            ps: payload.policeStation || null,
            district: payload.district || null,
            state: payload.state || null,
            pin: payload.pinCode || null
          }
        );

        await conn.execute(
          `INSERT INTO patient_medical_profiles
            (patient_id, blood_group, height_cm, weight_kg, allergies, existing_conditions,
             emergency_contact, emergency_contact_relation)
           VALUES (:patientId, :bloodGroup, :height, :weight, :allergies, :conditions, :ecContact, :ecRelation)`,
          {
            patientId,
            bloodGroup: payload.bloodGroup || null,
            height: payload.heightCm || null,
            weight: payload.weightKg || null,
            allergies: payload.allergies || null,
            conditions: payload.existingConditions || null,
            ecContact: payload.emergencyContact || null,
            ecRelation: payload.emergencyContactRelation || null
          }
        );

        await auditService.log(
          {
            userId: actorUserId,
            action: 'PATIENT_CREATED',
            entity: 'patient',
            entityId: patientId,
            newValue: { healthId, registrationNumber, name: payload.name, mobile: payload.mobile }
          },
          conn
        );

        return { id: patientId, healthId, registrationNumber };
      });
    } catch (err) {
      lastErr = err;
      // Retry only on a genuine Health ID/registration-number race (unique
      // constraint violation); everything else should surface immediately.
      const isDupeKeyRace =
        err && err.code === 'ER_DUP_ENTRY' && /health_id|registration_number/.test(err.sqlMessage || '');
      if (!isDupeKeyRace || attempt === MAX_ATTEMPTS) throw err;
    }
  }
  throw lastErr;
}

/**
 * Searches patients by Health ID, name, mobile, registration number, or
 * Aadhaar last-4. Never searches by raw Aadhaar.
 */
async function searchPatients({ q, limit = 10 }) {
  if (!q || q.trim().length < 2) return [];
  const like = `%${q.trim()}%`;
  const isDigits = /^\d+$/.test(q.trim());

  // NOTE: pool.query (not pool.execute) is deliberate here — mysql2's
  // execute() uses server-side prepared statements, which fail with
  // "Incorrect arguments to mysqld_stmt_execute" when LIMIT is bound as
  // a placeholder on some MySQL 8.0.x point releases. query() still
  // parameterizes safely (no string concatenation), it just doesn't use
  // a server-side prepared statement, which sidesteps that bug. Applied
  // to every LIMIT/OFFSET-bound query in this codebase — see the same
  // note in listPatients below, and in opdService/billingService/
  // adminService's paginated list queries.
  const [rows] = await pool.query(
    `SELECT p.id, p.health_id, p.registration_number, p.name, p.gender, p.age_years, p.mobile,
            p.aadhaar_last4, pa.district,
            (SELECT MAX(v.checked_in_at) FROM opd_visits v WHERE v.patient_id = p.id) AS last_visit
     FROM patients p
     LEFT JOIN patient_addresses pa ON pa.patient_id = p.id
     WHERE p.deleted_at IS NULL
       AND (
         p.health_id = :exact
         OR p.registration_number LIKE :like
         OR p.name LIKE :like
         OR p.mobile LIKE :like
         OR (:isDigits AND LENGTH(:q) = 4 AND p.aadhaar_last4 = :q)
       )
     ORDER BY p.created_at DESC
     LIMIT :limit`,
    { exact: q.trim(), like, isDigits: isDigits ? 1 : 0, q: q.trim(), limit }
  );

  return rows.map((r) => ({ ...r, aadhaar_masked: aadhaarUtil.mask(r.aadhaar_last4) }));
}

async function listPatients({ page = 1, pageSize = 20 }) {
  const offset = (page - 1) * pageSize;
  const [rows] = await pool.query(
    `SELECT p.id, p.health_id, p.registration_number, p.name, p.gender, p.age_years, p.mobile, p.created_at
     FROM patients p WHERE p.deleted_at IS NULL
     ORDER BY p.created_at DESC LIMIT :limit OFFSET :offset`,
    { limit: pageSize, offset }
  );
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM patients WHERE deleted_at IS NULL');
  return { rows, total, page, pageSize };
}

async function getPatientProfile(healthIdOrId) {
  const isNumericId = /^\d+$/.test(String(healthIdOrId)) && String(healthIdOrId).length < 8;
  const [[patient]] = await pool.execute(
    `SELECT p.*, pa.address, pa.village_town, pa.police_station, pa.district, pa.state, pa.pin_code,
            m.blood_group, m.height_cm, m.weight_kg, m.allergies, m.existing_conditions,
            m.emergency_contact, m.emergency_contact_relation,
            b.name AS branch_name
     FROM patients p
     LEFT JOIN patient_addresses pa ON pa.patient_id = p.id
     LEFT JOIN patient_medical_profiles m ON m.patient_id = p.id
     LEFT JOIN branches b ON b.id = p.branch_id
     WHERE p.deleted_at IS NULL AND (p.health_id = :key ${isNumericId ? 'OR p.id = :key' : ''})
     LIMIT 1`,
    { key: healthIdOrId }
  );
  if (!patient) return null;

  patient.aadhaar_masked = aadhaarUtil.mask(patient.aadhaar_last4);
  delete patient.aadhaar_encrypted;
  delete patient.aadhaar_iv;
  delete patient.aadhaar_hash;

  const [opdHistory] = await pool.execute(
    `SELECT v.id AS visit_id, v.visit_code, v.checked_in_at, v.status,
            d.doctor_code, du.name AS doctor_name, dept.name AS department_name,
            c.diagnosis, c.follow_up_date,
            i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.net_amount
     FROM opd_visits v
     JOIN doctors d ON d.id = v.doctor_id
     JOIN users du ON du.id = d.user_id
     JOIN appointments a ON a.id = v.appointment_id
     JOIN departments dept ON dept.id = a.department_id
     LEFT JOIN opd_consultations c ON c.visit_id = v.id
     LEFT JOIN invoices i ON i.visit_id = v.id
     WHERE v.patient_id = :id
     ORDER BY v.checked_in_at DESC`,
    { id: patient.id }
  );

  const [prescriptions] = await pool.execute(
    `SELECT pr.id, pr.prescription_code, pr.version, pr.is_current, pr.created_at,
            du.name AS doctor_name
     FROM prescriptions pr
     JOIN doctors d ON d.id = pr.doctor_id
     JOIN users du ON du.id = d.user_id
     WHERE pr.patient_id = :id AND pr.is_current = 1
     ORDER BY pr.created_at DESC`,
    { id: patient.id }
  );

  const [billing] = await pool.execute(
    `SELECT i.id, i.invoice_number, i.created_at, i.net_amount, i.discount_amount, i.status,
            (SELECT p2.method FROM payments p2 WHERE p2.invoice_id = i.id ORDER BY p2.paid_at DESC LIMIT 1) AS payment_method
     FROM invoices i WHERE i.patient_id = :id ORDER BY i.created_at DESC`,
    { id: patient.id }
  );

  return { patient, opdHistory, prescriptions, billing };
}

/**
 * Updates a patient's editable fields. Health ID, registration number,
 * and branch are NEVER changed here — those are permanent per the
 * architectural rule that Health ID must never change. Aadhaar can be
 * added/replaced (re-encrypted) but is left untouched if not supplied.
 */
async function updatePatient(patientId, payload, actorUserId) {
  return withTransaction(async (conn) => {
    const [[before]] = await conn.execute('SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL FOR UPDATE', {
      id: patientId
    });
    if (!before) throw new AppError('Patient not found', 404);

    let aadhaarClause = '';
    const params = {
      id: patientId,
      name: payload.name,
      fatherName: payload.fatherName || null,
      husbandName: payload.husbandName || null,
      gender: payload.gender,
      dob: payload.dob || null,
      ageYears: payload.ageYears || null,
      mobile: payload.mobile,
      altMobile: payload.altMobile || null,
      email: payload.email ? payload.email.trim().toLowerCase() : null
    };

    if (payload.aadhaar) {
      if (!aadhaarUtil.isValid(payload.aadhaar)) throw new AppError('Aadhaar number must be 12 digits', 422);
      const newHash = aadhaarUtil.hash(payload.aadhaar);
      const [dupe] = await conn.execute(
        'SELECT id FROM patients WHERE aadhaar_hash = :hash AND id <> :id AND deleted_at IS NULL LIMIT 1',
        { hash: newHash, id: patientId }
      );
      if (dupe.length) throw new AppError('Another patient is already registered with this Aadhaar number', 409);

      const enc = aadhaarUtil.encrypt(payload.aadhaar);
      aadhaarClause = ', aadhaar_encrypted = :aadhaarEncrypted, aadhaar_iv = :aadhaarIv, aadhaar_hash = :aadhaarHash, aadhaar_last4 = :aadhaarLast4';
      params.aadhaarEncrypted = enc.encrypted;
      params.aadhaarIv = enc.iv;
      params.aadhaarHash = newHash;
      params.aadhaarLast4 = aadhaarUtil.last4(payload.aadhaar);
    }

    await conn.execute(
      `UPDATE patients SET name = :name, father_name = :fatherName, husband_name = :husbandName,
         gender = :gender, dob = :dob, age_years = :ageYears, mobile = :mobile,
         alt_mobile = :altMobile, email = :email ${aadhaarClause}
       WHERE id = :id`,
      params
    );

    await conn.execute(
      `INSERT INTO patient_addresses (patient_id, address, village_town, police_station, district, state, pin_code)
       VALUES (:id, :address, :village, :ps, :district, :state, :pin)
       ON DUPLICATE KEY UPDATE address = VALUES(address), village_town = VALUES(village_town),
         police_station = VALUES(police_station), district = VALUES(district), state = VALUES(state), pin_code = VALUES(pin_code)`,
      {
        id: patientId,
        address: payload.address || null,
        village: payload.villageTown || null,
        ps: payload.policeStation || null,
        district: payload.district || null,
        state: payload.state || null,
        pin: payload.pinCode || null
      }
    );

    await conn.execute(
      `INSERT INTO patient_medical_profiles
        (patient_id, blood_group, height_cm, weight_kg, allergies, existing_conditions, emergency_contact, emergency_contact_relation)
       VALUES (:id, :bloodGroup, :height, :weight, :allergies, :conditions, :ecContact, :ecRelation)
       ON DUPLICATE KEY UPDATE blood_group = VALUES(blood_group), height_cm = VALUES(height_cm),
         weight_kg = VALUES(weight_kg), allergies = VALUES(allergies), existing_conditions = VALUES(existing_conditions),
         emergency_contact = VALUES(emergency_contact), emergency_contact_relation = VALUES(emergency_contact_relation)`,
      {
        id: patientId,
        bloodGroup: payload.bloodGroup || null,
        height: payload.heightCm || null,
        weight: payload.weightKg || null,
        allergies: payload.allergies || null,
        conditions: payload.existingConditions || null,
        ecContact: payload.emergencyContact || null,
        ecRelation: payload.emergencyContactRelation || null
      }
    );

    await auditService.log(
      {
        userId: actorUserId,
        action: 'PATIENT_UPDATED',
        entity: 'patient',
        entityId: patientId,
        oldValue: { name: before.name, mobile: before.mobile, email: before.email },
        newValue: { name: payload.name, mobile: payload.mobile, email: payload.email }
      },
      conn
    );
  });
}

/**
 * Soft-deletes a patient (business rule: a deleted patient must NOT
 * destroy medical history — deleted_at is set, nothing is removed).
 * Refuses to delete a patient with an active/future appointment, so a
 * record can't disappear out from under an in-progress visit.
 */
async function softDeletePatient(patientId, actorUserId) {
  return withTransaction(async (conn) => {
    const [[patient]] = await conn.execute('SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL FOR UPDATE', {
      id: patientId
    });
    if (!patient) throw new AppError('Patient not found', 404);

    const [activeAppointments] = await conn.execute(
      `SELECT id FROM appointments
       WHERE patient_id = :id AND status IN ('BOOKED','RESCHEDULED') AND appointment_date >= CURDATE()
       LIMIT 1`,
      { id: patientId }
    );
    if (activeAppointments.length) {
      throw new AppError('This patient has an upcoming appointment — cancel it before deleting the record', 409);
    }

    await conn.execute('UPDATE patients SET deleted_at = NOW() WHERE id = :id', { id: patientId });

    // Deactivate any linked patient-portal login too, but keep the row
    // (and its audit trail) intact.
    await conn.execute("UPDATE users SET is_active = 0 WHERE patient_id = :id", { id: patientId });

    await auditService.log(
      {
        userId: actorUserId,
        action: 'PATIENT_DELETED',
        entity: 'patient',
        entityId: patientId,
        oldValue: { name: patient.name, healthId: patient.health_id }
      },
      conn
    );
  });
}

module.exports = {
  registerPatient,
  searchPatients,
  listPatients,
  getPatientProfile,
  updatePatient,
  softDeletePatient
};
