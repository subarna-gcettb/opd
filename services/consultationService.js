const { pool, withTransaction } = require('../config/database');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

/**
 * Doctor-scope authorization guard. A doctor may only open visits
 * assigned to them, unless they hold a cross-doctor permission.
 * Closes the IDOR path of guessing another doctor's visit ID.
 */
async function assertDoctorCanAccessVisit(visitId, user) {
  const [[visit]] = await pool.execute('SELECT doctor_id FROM opd_visits WHERE id = :id', { id: visitId });
  if (!visit) throw new AppError('Visit not found', 404);

  const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
  if (isSuperAdmin) return true;

  if (user.doctorId && visit.doctor_id === user.doctorId) return true;

  throw new AppError('You are not authorized to access this patient consultation', 403);
}

/** Full clinical context a doctor sees when opening a patient. */
async function getConsultationContext(visitId) {
  const [[visit]] = await pool.execute(
    `SELECT v.*, a.appointment_code, a.token_number, a.slot_time, a.appointment_date, a.reason,
            p.id AS patient_id, p.health_id, p.name AS patient_name, p.gender, p.age_years, p.dob, p.mobile,
            m.blood_group, m.allergies, m.existing_conditions, m.height_cm AS profile_height, m.weight_kg AS profile_weight,
            u.name AS doctor_name, dept.name AS department_name
     FROM opd_visits v
     JOIN appointments a ON a.id = v.appointment_id
     JOIN patients p ON p.id = v.patient_id
     LEFT JOIN patient_medical_profiles m ON m.patient_id = p.id
     JOIN doctors d ON d.id = v.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN departments dept ON dept.id = a.department_id
     WHERE v.id = :id`,
    { id: visitId }
  );
  if (!visit) return null;

  const [[consultation]] = await pool.execute(
    `SELECT c.*, vt.bp, vt.pulse, vt.temperature, vt.spo2, vt.weight_kg, vt.height_cm
     FROM opd_consultations c
     LEFT JOIN vitals vt ON vt.consultation_id = c.id
     WHERE c.visit_id = :id`,
    { id: visitId }
  );

  // Previous visits (excluding this one), with diagnosis and vitals trend.
  const [previousVisits] = await pool.execute(
    `SELECT v.id AS visit_id, v.checked_in_at, c.diagnosis, c.clinical_notes, c.follow_up_date,
            u.name AS doctor_name, vt.bp, vt.pulse, vt.weight_kg, vt.temperature, vt.spo2
     FROM opd_visits v
     JOIN doctors d ON d.id = v.doctor_id
     JOIN users u ON u.id = d.user_id
     LEFT JOIN opd_consultations c ON c.visit_id = v.id
     LEFT JOIN vitals vt ON vt.consultation_id = c.id
     WHERE v.patient_id = :patientId AND v.id <> :visitId AND v.status = 'COMPLETED'
     ORDER BY v.checked_in_at DESC LIMIT 20`,
    { patientId: visit.patient_id, visitId }
  );

  const [previousPrescriptions] = await pool.execute(
    `SELECT pr.id, pr.prescription_code, pr.version, pr.created_at, u.name AS doctor_name,
            c.diagnosis
     FROM prescriptions pr
     JOIN doctors d ON d.id = pr.doctor_id
     JOIN users u ON u.id = d.user_id
     LEFT JOIN opd_consultations c ON c.visit_id = pr.visit_id
     WHERE pr.patient_id = :patientId AND pr.is_current = 1
     ORDER BY pr.created_at DESC LIMIT 20`,
    { patientId: visit.patient_id }
  );

  const [currentPrescriptions] = await pool.execute(
    `SELECT pr.id, pr.prescription_code, pr.version FROM prescriptions pr
     WHERE pr.visit_id = :visitId AND pr.is_current = 1`,
    { visitId }
  );

  return { visit, consultation: consultation || null, previousVisits, previousPrescriptions, currentPrescriptions };
}

/**
 * Creates or updates the consultation record for a visit (plus vitals).
 * A consultation is editable while the visit is in progress; once the
 * visit is COMPLETED it is locked, and corrections to the clinical record
 * go through the prescription amendment mechanism / audit trail.
 */
async function saveConsultation(visitId, payload, actorUserId) {
  return withTransaction(async (conn) => {
    const [[visit]] = await conn.execute('SELECT * FROM opd_visits WHERE id = :id FOR UPDATE', { id: visitId });
    if (!visit) throw new AppError('Visit not found', 404);
    if (visit.status === 'CANCELLED') throw new AppError('This visit was cancelled', 409);

    const [[existing]] = await conn.execute('SELECT * FROM opd_consultations WHERE visit_id = :id', { id: visitId });

    let consultationId;
    if (existing) {
      if (visit.status === 'COMPLETED') {
        throw new AppError('This consultation is finalized and cannot be edited', 409);
      }
      await conn.execute(
        `UPDATE opd_consultations SET complaints = :complaints, symptoms = :symptoms,
          clinical_notes = :notes, diagnosis = :diagnosis, investigation_advice = :advice,
          follow_up_date = :followUp WHERE id = :id`,
        {
          complaints: payload.complaints || null,
          symptoms: payload.symptoms || null,
          notes: payload.clinicalNotes || null,
          diagnosis: payload.diagnosis || null,
          advice: payload.investigationAdvice || null,
          followUp: payload.followUpDate || null,
          id: existing.id
        }
      );
      consultationId = existing.id;
    } else {
      const [result] = await conn.execute(
        `INSERT INTO opd_consultations
          (visit_id, complaints, symptoms, clinical_notes, diagnosis, investigation_advice, follow_up_date, created_by)
         VALUES (:visitId, :complaints, :symptoms, :notes, :diagnosis, :advice, :followUp, :createdBy)`,
        {
          visitId,
          complaints: payload.complaints || null,
          symptoms: payload.symptoms || null,
          notes: payload.clinicalNotes || null,
          diagnosis: payload.diagnosis || null,
          advice: payload.investigationAdvice || null,
          followUp: payload.followUpDate || null,
          createdBy: actorUserId
        }
      );
      consultationId = result.insertId;
    }

    // Vitals (1:1 with consultation)
    await conn.execute(
      `INSERT INTO vitals (consultation_id, bp, pulse, temperature, spo2, weight_kg, height_cm)
       VALUES (:consultationId, :bp, :pulse, :temperature, :spo2, :weight, :height)
       ON DUPLICATE KEY UPDATE bp = VALUES(bp), pulse = VALUES(pulse), temperature = VALUES(temperature),
         spo2 = VALUES(spo2), weight_kg = VALUES(weight_kg), height_cm = VALUES(height_cm)`,
      {
        consultationId,
        bp: payload.bp || null,
        pulse: payload.pulse || null,
        temperature: payload.temperature || null,
        spo2: payload.spo2 || null,
        weight: payload.weightKg || null,
        height: payload.heightCm || null
      }
    );

    // Keep the patient's standing medical profile current where the
    // doctor has recorded newer values.
    if (payload.allergies !== undefined || payload.weightKg || payload.heightCm) {
      await conn.execute(
        `UPDATE patient_medical_profiles SET
           allergies = COALESCE(:allergies, allergies),
           weight_kg = COALESCE(:weight, weight_kg),
           height_cm = COALESCE(:height, height_cm)
         WHERE patient_id = :patientId`,
        {
          allergies: payload.allergies || null,
          weight: payload.weightKg || null,
          height: payload.heightCm || null,
          patientId: visit.patient_id
        }
      );
    }

    // Recording a consultation moves the visit into IN_CONSULTATION if
    // it hasn't already progressed.
    if (['WAITING', 'CALLED'].includes(visit.status)) {
      await conn.execute(
        "UPDATE opd_visits SET status = 'IN_CONSULTATION', consultation_started_at = COALESCE(consultation_started_at, NOW()) WHERE id = :id",
        { id: visitId }
      );
    }

    await auditService.log(
      {
        userId: actorUserId,
        action: existing ? 'CONSULTATION_UPDATED' : 'CONSULTATION_CREATED',
        entity: 'opd_consultation',
        entityId: consultationId,
        newValue: { visitId, diagnosis: payload.diagnosis, followUp: payload.followUpDate }
      },
      conn
    );

    return { consultationId };
  });
}

/** Doctor dashboard counters for today. */
async function getDoctorDashboard(doctorId, dateStr) {
  const [[counts]] = await pool.execute(
    `SELECT
       COUNT(*) AS total_today,
       SUM(v.status = 'WAITING') AS waiting,
       SUM(v.status = 'CALLED') AS called,
       SUM(v.status = 'IN_CONSULTATION') AS in_consultation,
       SUM(v.status = 'COMPLETED') AS completed
     FROM opd_visits v
     JOIN appointments a ON a.id = v.appointment_id
     WHERE v.doctor_id = :doctorId AND a.appointment_date = :date AND v.status <> 'CANCELLED'`,
    { doctorId, date: dateStr }
  );

  const [[{ upcoming }]] = await pool.execute(
    `SELECT COUNT(*) AS upcoming FROM appointments
     WHERE doctor_id = :doctorId AND appointment_date > :date AND status IN ('BOOKED','RESCHEDULED')`,
    { doctorId, date: dateStr }
  );

  return {
    totalToday: Number(counts.total_today) || 0,
    waiting: Number(counts.waiting) || 0,
    called: Number(counts.called) || 0,
    inConsultation: Number(counts.in_consultation) || 0,
    completed: Number(counts.completed) || 0,
    upcoming: Number(upcoming) || 0
  };
}

module.exports = {
  assertDoctorCanAccessVisit,
  getConsultationContext,
  saveConsultation,
  getDoctorDashboard
};
