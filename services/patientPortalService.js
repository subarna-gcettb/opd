const bcrypt = require('bcrypt');
const { pool, withTransaction } = require('../config/database');
const authConfig = require('../config/auth');
const auditService = require('./auditService');
const settingsService = require('./settingsService');
const patientService = require('./patientService');
const AppError = require('../utils/AppError');

/**
 * Deterministic default password for portal accounts auto-created at
 * reception during patient registration. The PATTERN is fixed and
 * documented (SECURITY.md); the actual password differs per patient
 * because it's derived from their own mobile number:
 *
 *   <first word of hospital name>@<last 4 digits of mobile>
 *   e.g. mobile 98765xxxxx at "Chhayabithi" -> "Chhayabithi@xxxx"
 *
 * must_reset_password is always set to 1 for these accounts, so the
 * patient is forced to choose their own password on first login —
 * this is the mitigation for the pattern being guessable if someone
 * knows both the hospital name and the patient's mobile number.
 */
async function generateDefaultPassword(mobile) {
  const settings = await settingsService.getSettings();
  const prefix = (settings.hospital_name || 'Hospital').split(/\s+/)[0];
  const last4 = String(mobile || '').replace(/\D/g, '').slice(-4).padStart(4, '0');
  return `${prefix}@${last4}`;
}

/**
 * Creates a patient-portal login account for an EXISTING patient record.
 * One patient can have at most one portal account (users.patient_id is
 * UNIQUE). Requires an email on file (patients.email, or one supplied
 * here, which is then saved onto the patient record) — the portal logs
 * in with that email, exactly like staff/doctor accounts.
 */
async function createPortalAccount(patientId, payload, actorUserId) {
  return withTransaction(async (conn) => {
    const [[patient]] = await conn.execute('SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL FOR UPDATE', {
      id: patientId
    });
    if (!patient) throw new AppError('Patient not found', 404);

    const [[existingLink]] = await conn.execute('SELECT id FROM users WHERE patient_id = :id', { id: patientId });
    if (existingLink) throw new AppError('This patient already has a portal account', 409);

    const email = (payload.email || patient.email || '').trim().toLowerCase();
    if (!email) throw new AppError('An email address is required to create a portal account', 422);

    const [existingEmail] = await conn.execute('SELECT id FROM users WHERE email = :email', { email });
    if (existingEmail.length) throw new AppError('A user account with this email already exists', 409);

    // Keep the patient record's email in sync if a new one was supplied here.
    if (payload.email && payload.email.trim().toLowerCase() !== (patient.email || '')) {
      await conn.execute('UPDATE patients SET email = :email WHERE id = :id', { email, id: patientId });
    }

    const tempPassword = payload.temporaryPassword || (await generateDefaultPassword(patient.mobile));
    const passwordHash = await bcrypt.hash(tempPassword, authConfig.bcryptRounds);

    const [result] = await conn.execute(
      `INSERT INTO users (branch_id, patient_id, name, email, mobile, password_hash, must_reset_password, is_active)
       VALUES (:branchId, :patientId, :name, :email, :mobile, :hash, 1, 1)`,
      {
        branchId: patient.branch_id,
        patientId,
        name: patient.name,
        email,
        mobile: patient.mobile,
        hash: passwordHash
      }
    );
    const userId = result.insertId;

    const [[role]] = await conn.execute("SELECT id FROM roles WHERE code = 'PATIENT'");
    if (role) {
      await conn.execute('INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)', {
        userId,
        roleId: role.id
      });
    }

    await auditService.log(
      {
        userId: actorUserId,
        action: 'PATIENT_PORTAL_ACCOUNT_CREATED',
        entity: 'user',
        entityId: userId,
        newValue: { patientId, email }
      },
      conn
    );

    return { userId, email, temporaryPassword: tempPassword, patientName: patient.name };
  });
}

/**
 * Everything a patient sees on their own dashboard. Always scoped by the
 * numeric patientId resolved server-side from the session (req.user.
 * patientId) — callers must never accept this id from a request
 * parameter, or one patient could view another's records.
 */
async function getOwnDashboard(patientId) {
  const [[patient]] = await pool.execute(
    `SELECT p.*, pa.address, pa.village_town, pa.police_station, pa.district, pa.state, pa.pin_code,
            m.blood_group, m.height_cm, m.weight_kg, m.allergies, m.existing_conditions,
            b.name AS branch_name
     FROM patients p
     LEFT JOIN patient_addresses pa ON pa.patient_id = p.id
     LEFT JOIN patient_medical_profiles m ON m.patient_id = p.id
     LEFT JOIN branches b ON b.id = p.branch_id
     WHERE p.id = :id AND p.deleted_at IS NULL`,
    { id: patientId }
  );
  if (!patient) throw new AppError('Patient record not found', 404);

  delete patient.aadhaar_encrypted;
  delete patient.aadhaar_iv;
  delete patient.aadhaar_hash;

  const [upcoming] = await pool.execute(
    `SELECT a.id AS appointment_id, a.appointment_date, a.slot_time, a.token_number, a.status,
            u.name AS doctor_name, dept.name AS department_name
     FROM appointments a
     JOIN doctors d ON d.id = a.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN departments dept ON dept.id = a.department_id
     WHERE a.patient_id = :id AND a.appointment_date >= CURDATE()
       AND a.status IN ('BOOKED','RESCHEDULED')
     ORDER BY a.appointment_date, a.slot_time`,
    { id: patientId }
  );

  const [history] = await pool.execute(
    `SELECT v.checked_in_at, v.status AS visit_status, u.name AS doctor_name, dept.name AS department_name,
            c.diagnosis, c.follow_up_date
     FROM opd_visits v
     JOIN doctors d ON d.id = v.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN appointments a ON a.id = v.appointment_id
     JOIN departments dept ON dept.id = a.department_id
     LEFT JOIN opd_consultations c ON c.visit_id = v.id
     WHERE v.patient_id = :id AND v.status = 'COMPLETED'
     ORDER BY v.checked_in_at DESC LIMIT 25`,
    { id: patientId }
  );

  const [prescriptions] = await pool.execute(
    `SELECT pr.id, pr.prescription_code, pr.version, pr.created_at, u.name AS doctor_name
     FROM prescriptions pr
     JOIN doctors d ON d.id = pr.doctor_id
     JOIN users u ON u.id = d.user_id
     WHERE pr.patient_id = :id AND pr.is_current = 1
     ORDER BY pr.created_at DESC`,
    { id: patientId }
  );

  const [invoices] = await pool.execute(
    `SELECT i.id, i.invoice_number, i.created_at, i.net_amount, i.discount_amount, i.status
     FROM invoices i WHERE i.patient_id = :id ORDER BY i.created_at DESC`,
    { id: patientId }
  );

  return { patient, upcoming, history, prescriptions, invoices };
}

/**
 * Lets a patient update their OWN contact/basic-medical info. Deliberately
 * excludes identity fields (name, gender, DOB, Aadhaar) — those require
 * staff review to change, to protect record integrity (e.g. preventing
 * someone from quietly renaming a record to impersonate another
 * patient). Reuses patientService.updatePatient by merging the current
 * identity fields back in unchanged.
 */
async function updateOwnProfile(patientId, payload) {
  const [[current]] = await pool.execute('SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL', { id: patientId });
  if (!current) throw new AppError('Patient record not found', 404);

  await patientService.updatePatient(
    patientId,
    {
      // Identity fields: unchanged, carried over from the existing record.
      name: current.name,
      fatherName: current.father_name,
      husbandName: current.husband_name,
      gender: current.gender,
      dob: current.dob,
      ageYears: current.age_years,
      // Self-editable fields: from the patient's submission.
      mobile: payload.mobile,
      altMobile: payload.altMobile,
      email: payload.email,
      address: payload.address,
      villageTown: payload.villageTown,
      policeStation: payload.policeStation,
      district: payload.district,
      state: payload.state,
      pinCode: payload.pinCode,
      bloodGroup: payload.bloodGroup,
      heightCm: payload.heightCm,
      weightKg: payload.weightKg,
      allergies: payload.allergies,
      existingConditions: payload.existingConditions,
      emergencyContact: payload.emergencyContact,
      emergencyContactRelation: payload.emergencyContactRelation
      // Aadhaar intentionally omitted — not self-editable.
    },
    null // system-initiated on the patient's own behalf; no staff actor
  );
}

module.exports = { createPortalAccount, getOwnDashboard, generateDefaultPassword, updateOwnProfile };
