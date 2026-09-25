const { pool, withTransaction } = require('../config/database');
const sequenceService = require('./sequenceService');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

/** Prescription code: RX-YYMMDD-NNNN (stable across versions of the same prescription) */
async function generatePrescriptionCode(conn, dateStr) {
  const compact = dateStr.replace(/-/g, '').slice(2);
  const seq = await sequenceService.nextValue(conn, `prescription:${dateStr}`);
  return `RX${compact}${sequenceService.pad(seq, 4)}`;
}

function normalizeItems(rawItems) {
  // Accepts either an array of objects, or parallel arrays posted from the
  // dynamic prescription form (medicineName[], dosage[], ...).
  if (Array.isArray(rawItems)) return rawItems;
  return [];
}

/**
 * Builds the item list from a posted form body with parallel arrays.
 */
function itemsFromBody(body) {
  const names = [].concat(body.medicineName || []);
  const medicineIds = [].concat(body.medicineId || []);
  const dosages = [].concat(body.dosage || []);
  const frequencies = [].concat(body.frequency || []);
  const durations = [].concat(body.duration || []);
  const routes = [].concat(body.route || []);
  const quantities = [].concat(body.quantity || []);
  const instructions = [].concat(body.instructions || []);

  const items = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i] || !String(names[i]).trim()) continue;
    items.push({
      medicineId: medicineIds[i] ? Number(medicineIds[i]) || null : null,
      medicineName: String(names[i]).trim(),
      dosage: dosages[i] || null,
      frequency: frequencies[i] || null,
      duration: durations[i] || null,
      route: routes[i] || null,
      quantity: quantities[i] || null,
      instructions: instructions[i] || null
    });
  }
  return items;
}

/**
 * Creates version 1 of a prescription for a visit.
 * The barcode value is ALWAYS the patient's Health ID — never diagnosis,
 * medicines, Aadhaar, or any other medical/PII data.
 */
async function createPrescription(visitId, items, actorUserId) {
  if (!items.length) throw new AppError('Add at least one medicine to the prescription', 422);

  return withTransaction(async (conn) => {
    const [[visit]] = await conn.execute(
      `SELECT v.id, v.patient_id, v.doctor_id, v.status, p.health_id
       FROM opd_visits v JOIN patients p ON p.id = v.patient_id
       WHERE v.id = :id FOR UPDATE`,
      { id: visitId }
    );
    if (!visit) throw new AppError('Visit not found', 404);
    if (visit.status === 'CANCELLED') throw new AppError('This visit was cancelled', 409);

    const [existing] = await conn.execute(
      'SELECT id FROM prescriptions WHERE visit_id = :id AND is_current = 1',
      { id: visitId }
    );
    if (existing.length) {
      throw new AppError('A prescription already exists for this visit. Use the amendment option to correct it.', 409);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const code = await generatePrescriptionCode(conn, dateStr);

    const [result] = await conn.execute(
      `INSERT INTO prescriptions
        (prescription_code, visit_id, patient_id, doctor_id, version, is_current, barcode_value, created_by)
       VALUES (:code, :visitId, :patientId, :doctorId, 1, 1, :barcode, :createdBy)`,
      {
        code,
        visitId,
        patientId: visit.patient_id,
        doctorId: visit.doctor_id,
        barcode: visit.health_id,
        createdBy: actorUserId
      }
    );
    const prescriptionId = result.insertId;

    await insertItems(conn, prescriptionId, items);

    await auditService.log(
      {
        userId: actorUserId,
        action: 'PRESCRIPTION_CREATED',
        entity: 'prescription',
        entityId: prescriptionId,
        newValue: { code, version: 1, visitId, itemCount: items.length }
      },
      conn
    );

    return { id: prescriptionId, code, version: 1 };
  });
}

async function insertItems(conn, prescriptionId, items) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await conn.execute(
      `INSERT INTO prescription_items
        (prescription_id, medicine_id, medicine_name_freetext, dosage, frequency, duration, route, quantity, instructions, sort_order)
       VALUES (:prescriptionId, :medicineId, :name, :dosage, :frequency, :duration, :route, :quantity, :instructions, :sortOrder)`,
      {
        prescriptionId,
        medicineId: it.medicineId || null,
        name: it.medicineName,
        dosage: it.dosage || null,
        frequency: it.frequency || null,
        duration: it.duration || null,
        route: it.route || null,
        quantity: it.quantity || null,
        instructions: it.instructions || null,
        sortOrder: i
      }
    );
  }
}

/**
 * Amends a finalized prescription. The original row is NEVER edited or
 * deleted — it is marked is_current = 0 and a new row is inserted with
 * version + 1, linked via amended_from_id. Full history is preserved.
 */
async function amendPrescription(prescriptionId, items, reason, actorUserId) {
  if (!items.length) throw new AppError('An amended prescription must contain at least one medicine', 422);
  if (!reason || !reason.trim()) throw new AppError('An amendment reason is required', 422);

  return withTransaction(async (conn) => {
    const [[original]] = await conn.execute('SELECT * FROM prescriptions WHERE id = :id FOR UPDATE', {
      id: prescriptionId
    });
    if (!original) throw new AppError('Prescription not found', 404);
    if (!original.is_current) throw new AppError('Only the current version of a prescription can be amended', 409);

    await conn.execute('UPDATE prescriptions SET is_current = 0 WHERE id = :id', { id: prescriptionId });

    const [result] = await conn.execute(
      `INSERT INTO prescriptions
        (prescription_code, visit_id, patient_id, doctor_id, version, is_current, barcode_value,
         amended_from_id, amendment_reason, created_by)
       VALUES (:code, :visitId, :patientId, :doctorId, :version, 1, :barcode, :amendedFrom, :reason, :createdBy)`,
      {
        code: original.prescription_code,
        visitId: original.visit_id,
        patientId: original.patient_id,
        doctorId: original.doctor_id,
        version: original.version + 1,
        barcode: original.barcode_value,
        amendedFrom: prescriptionId,
        reason: reason.trim(),
        createdBy: actorUserId
      }
    );
    const newId = result.insertId;

    await insertItems(conn, newId, items);

    await auditService.log(
      {
        userId: actorUserId,
        action: 'PRESCRIPTION_AMENDED',
        entity: 'prescription',
        entityId: newId,
        oldValue: { id: prescriptionId, version: original.version },
        newValue: { id: newId, version: original.version + 1, reason: reason.trim() }
      },
      conn
    );

    return { id: newId, code: original.prescription_code, version: original.version + 1 };
  });
}

async function getPrescription(prescriptionId) {
  const [[prescription]] = await pool.execute(
    `SELECT pr.*, p.health_id, p.name AS patient_name, p.age_years, p.gender, p.mobile,
            m.allergies,
            u.name AS doctor_name, d.qualification, d.professional_reg_number, d.specialisation,
            dept.name AS department_name,
            c.diagnosis, c.investigation_advice, c.follow_up_date, c.complaints,
            vt.bp, vt.pulse, vt.temperature, vt.spo2, vt.weight_kg, vt.height_cm,
            v.visit_code, b.name AS branch_name
     FROM prescriptions pr
     JOIN patients p ON p.id = pr.patient_id
     LEFT JOIN patient_medical_profiles m ON m.patient_id = p.id
     JOIN doctors d ON d.id = pr.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN opd_visits v ON v.id = pr.visit_id
     JOIN appointments a ON a.id = v.appointment_id
     JOIN departments dept ON dept.id = a.department_id
     JOIN branches b ON b.id = v.branch_id
     LEFT JOIN opd_consultations c ON c.visit_id = pr.visit_id
     LEFT JOIN vitals vt ON vt.consultation_id = c.id
     WHERE pr.id = :id`,
    { id: prescriptionId }
  );
  if (!prescription) return null;

  const [items] = await pool.execute(
    'SELECT * FROM prescription_items WHERE prescription_id = :id ORDER BY sort_order',
    { id: prescriptionId }
  );

  const [versions] = await pool.execute(
    `SELECT id, version, is_current, amendment_reason, created_at
     FROM prescriptions WHERE prescription_code = :code ORDER BY version DESC`,
    { code: prescription.prescription_code }
  );

  return { prescription, items, versions };
}

/** Authorization: a doctor may only amend prescriptions they issued. */
async function assertCanAmend(prescriptionId, user) {
  const [[row]] = await pool.execute('SELECT doctor_id FROM prescriptions WHERE id = :id', { id: prescriptionId });
  if (!row) throw new AppError('Prescription not found', 404);
  if (user.roles.includes('SUPER_ADMIN')) return true;
  if (user.doctorId && row.doctor_id === user.doctorId) return true;
  throw new AppError('You can only amend prescriptions you issued', 403);
}

module.exports = {
  createPrescription,
  amendPrescription,
  getPrescription,
  assertCanAmend,
  itemsFromBody,
  normalizeItems
};
