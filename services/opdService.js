const { pool, withTransaction } = require('../config/database');
const sequenceService = require('./sequenceService');
const scheduleService = require('./scheduleService');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

function calculatePregnancy(lmpDate, pregnancyStatus, asOfDate) {
  if (pregnancyStatus !== 'PREGNANT' || !lmpDate) {
    return { status: pregnancyStatus || 'UNKNOWN', weeks: null, days: null, edd: null };
  }
  const lmp = new Date(lmpDate + 'T00:00:00Z');
  const asOf = new Date((asOfDate || new Date().toISOString().slice(0,10)) + 'T00:00:00Z');
  const diffDays = Math.max(0, Math.floor((asOf - lmp) / 86400000));
  const eddDate = new Date(lmp.getTime() + 280 * 86400000);
  const edd = eddDate.toISOString().slice(0,10);
  return { status: 'PREGNANT', weeks: Math.floor(diffDays / 7), days: diffDays % 7, edd };
}

/** Appointment code: APT-YYMMDD-NNNN (global daily sequence) */
async function generateAppointmentCode(conn, dateStr) {
  const compact = dateStr.replace(/-/g, '').slice(2); // YYMMDD
  const seq = await sequenceService.nextValue(conn, `appointment:${dateStr}`);
  return `APT${compact}${sequenceService.pad(seq, 4)}`;
}

/** Visit code: VIS-YYMMDD-NNNN */
async function generateVisitCode(conn, dateStr) {
  const compact = dateStr.replace(/-/g, '').slice(2);
  const seq = await sequenceService.nextValue(conn, `visit:${dateStr}`);
  return `VIS${compact}${sequenceService.pad(seq, 4)}`;
}

/**
 * Token numbers are scoped per doctor per date, so two doctors can both
 * have "Token 001" on the same day. Uniqueness is additionally enforced
 * by uk_appt_doctor_date_token in the schema.
 */
async function generateToken(conn, dateStr) {
  // One hospital-wide token sequence per calendar day.
  return sequenceService.nextValue(conn, `token:date:${dateStr}`);
}

/**
 * Books an OPD appointment. In ONE transaction:
 *   validate slot -> reserve token -> create appointment -> create opd_visit
 * A visit is created immediately in WAITING state so the patient enters
 * the queue; appointment and visit lifecycles remain separate thereafter.
 */
async function bookAppointment(payload, actorUserId) {
  return withTransaction(async (conn) => {
    const { patientId, doctorId, branchId, departmentId, appointmentDate, slotTime, reason } = payload;
    const obstetric = calculatePregnancy(payload.lmpDate, payload.pregnancyStatus, appointmentDate);

    const [[patient]] = await conn.execute(
      'SELECT id, health_id, name, status FROM patients WHERE id = :id AND deleted_at IS NULL',
      { id: patientId }
    );
    if (!patient) throw new AppError('Patient not found', 404);
    if (patient.status === 'SUSPENDED') throw new AppError('This patient is suspended. Restore the patient before booking an appointment.', 409);

    const [[doctor]] = await conn.execute(
      'SELECT id, consultation_fee FROM doctors WHERE id = :id AND deleted_at IS NULL AND is_active = 1',
      { id: doctorId }
    );
    if (!doctor) throw new AppError('Doctor not found or inactive', 404);

    // Server-side slot validation with row locking (never trust the client).
    const check = await scheduleService.isSlotBookable(conn, doctorId, appointmentDate, slotTime);
    if (!check.ok) throw new AppError(check.reason, 409);

    const token = await generateToken(conn, appointmentDate);
    const appointmentCode = await generateAppointmentCode(conn, appointmentDate);

    const [apptResult] = await conn.execute(
      `INSERT INTO appointments
        (appointment_code, patient_id, doctor_id, branch_id, department_id,
         appointment_date, slot_time, token_number, reason,
         lmp_date, gravida, para, abortions, pregnancy_status,
         gestational_age_weeks, gestational_age_days, estimated_due_date, obstetric_notes,
         status, created_by)
       VALUES
        (:code, :patientId, :doctorId, :branchId, :departmentId,
         :date, :slotTime, :token, :reason,
         :lmpDate, :gravida, :para, :abortions, :pregnancyStatus,
         :gaWeeks, :gaDays, :edd, :obstetricNotes,
         'BOOKED', :createdBy)`,
      {
        code: appointmentCode,
        patientId,
        doctorId,
        branchId,
        departmentId,
        date: appointmentDate,
        slotTime,
        token,
        reason: reason || null,
        lmpDate: payload.lmpDate || null,
        gravida: payload.gravida === '' ? null : (payload.gravida ?? null),
        para: payload.para === '' ? null : (payload.para ?? null),
        abortions: payload.abortions === '' ? null : (payload.abortions ?? null),
        pregnancyStatus: obstetric.status,
        gaWeeks: obstetric.weeks,
        gaDays: obstetric.days,
        edd: obstetric.edd,
        obstetricNotes: payload.obstetricNotes || null,
        createdBy: actorUserId
      }
    );
    const appointmentId = apptResult.insertId;

    const visitCode = await generateVisitCode(conn, appointmentDate);
    const [visitResult] = await conn.execute(
      `INSERT INTO opd_visits (visit_code, appointment_id, patient_id, doctor_id, branch_id, status, queue_position)
       VALUES (:visitCode, :appointmentId, :patientId, :doctorId, :branchId, 'WAITING', :queuePosition)`,
      { visitCode, appointmentId, patientId, doctorId, branchId, queuePosition: token }
    );

    await auditService.log(
      {
        userId: actorUserId,
        action: 'APPOINTMENT_CREATED',
        entity: 'appointment',
        entityId: appointmentId,
        newValue: { appointmentCode, visitCode, token, healthId: patient.health_id, date: appointmentDate, slotTime }
      },
      conn
    );

    return {
      appointmentId,
      appointmentCode,
      visitId: visitResult.insertId,
      visitCode,
      token,
      consultationFee: doctor.consultation_fee
    };
  });
}

/**
 * Reschedules an appointment. The original row is updated but the previous
 * date/time is preserved in appointment_history — history is never overwritten.
 */
async function rescheduleAppointment(appointmentId, { newDate, newTime, reason }, actorUserId) {
  return withTransaction(async (conn) => {
    const [[appt]] = await conn.execute(
      'SELECT * FROM appointments WHERE id = :id FOR UPDATE',
      { id: appointmentId }
    );
    if (!appt) throw new AppError('Appointment not found', 404);
    if (['CANCELLED', 'COMPLETED'].includes(appt.status)) {
      throw new AppError(`A ${appt.status.toLowerCase()} appointment cannot be rescheduled`, 409);
    }

    const check = await scheduleService.isSlotBookable(conn, appt.doctor_id, newDate, newTime);
    if (!check.ok) throw new AppError(check.reason, 409);

    // New date => new token in that date's per-doctor sequence.
    const newToken = await generateToken(conn, appt.doctor_id, newDate);
    const obstetric = calculatePregnancy(appt.lmp_date, appt.pregnancy_status, newDate);

    await conn.execute(
      `UPDATE appointments SET appointment_date = :newDate, slot_time = :newTime,
        token_number = :newToken, gestational_age_weeks = :gaWeeks, gestational_age_days = :gaDays, estimated_due_date = :edd, status = 'RESCHEDULED' WHERE id = :id`,
      { newDate, newTime, newToken, gaWeeks: obstetric.weeks, gaDays: obstetric.days, edd: obstetric.edd, id: appointmentId }
    );

    await conn.execute('UPDATE opd_visits SET queue_position = :newToken WHERE appointment_id = :id AND status <> \'CANCELLED\'', { newToken, id: appointmentId });

    await conn.execute(
      `INSERT INTO appointment_history
        (appointment_id, old_date, old_time, new_date, new_time, action, reason, changed_by)
       VALUES (:id, :oldDate, :oldTime, :newDate, :newTime, 'RESCHEDULED', :reason, :changedBy)`,
      {
        id: appointmentId,
        oldDate: appt.appointment_date,
        oldTime: appt.slot_time,
        newDate,
        newTime,
        reason: reason || null,
        changedBy: actorUserId
      }
    );

    await auditService.log(
      {
        userId: actorUserId,
        action: 'APPOINTMENT_RESCHEDULED',
        entity: 'appointment',
        entityId: appointmentId,
        oldValue: { date: appt.appointment_date, time: appt.slot_time, token: appt.token_number },
        newValue: { date: newDate, time: newTime, token: newToken, reason }
      },
      conn
    );

    return { newToken };
  });
}

async function updateAppointmentDetails(appointmentId, payload, actorUserId) {
  const data = await getAppointment(appointmentId);
  if (!data) throw new AppError('Appointment not found', 404);
  if (['CANCELLED','COMPLETED'].includes(data.appointment.status)) throw new AppError('This appointment can no longer be edited', 409);

  const currentDate = new Date(data.appointment.appointment_date).toISOString().slice(0,10);
  if (payload.newDate !== currentDate || payload.newTime !== String(data.appointment.slot_time).slice(0,5)) {
    await rescheduleAppointment(appointmentId, { newDate: payload.newDate, newTime: payload.newTime, reason: payload.reason || 'Appointment details edited' }, actorUserId);
  }
  await pool.execute('UPDATE appointments SET reason=:reason WHERE id=:id', { reason: payload.reason || null, id: appointmentId });
  await auditService.log({
    userId: actorUserId, action: 'APPOINTMENT_DETAILS_UPDATED', entity: 'appointment', entityId: appointmentId,
    newValue: { reason: payload.reason || null, date: payload.newDate, time: payload.newTime }
  });
}

async function cancelAppointment(appointmentId, reason, actorUserId) {
  return withTransaction(async (conn) => {
    const [[appt]] = await conn.execute('SELECT * FROM appointments WHERE id = :id FOR UPDATE', { id: appointmentId });
    if (!appt) throw new AppError('Appointment not found', 404);
    if (appt.status === 'COMPLETED') throw new AppError('A completed appointment cannot be cancelled', 409);

    await conn.execute("UPDATE appointments SET status = 'CANCELLED' WHERE id = :id", { id: appointmentId });
    await conn.execute("UPDATE opd_visits SET status = 'CANCELLED' WHERE appointment_id = :id", { id: appointmentId });

    await conn.execute(
      `INSERT INTO appointment_history (appointment_id, old_date, old_time, action, reason, changed_by)
       VALUES (:id, :oldDate, :oldTime, 'CANCELLED', :reason, :changedBy)`,
      { id: appointmentId, oldDate: appt.appointment_date, oldTime: appt.slot_time, reason: reason || null, changedBy: actorUserId }
    );

    await auditService.log(
      {
        userId: actorUserId,
        action: 'APPOINTMENT_CANCELLED',
        entity: 'appointment',
        entityId: appointmentId,
        oldValue: { status: appt.status },
        newValue: { status: 'CANCELLED', reason }
      },
      conn
    );
  });
}

async function markNoShow(appointmentId, actorUserId) {
  return withTransaction(async (conn) => {
    const [[appt]] = await conn.execute('SELECT * FROM appointments WHERE id = :id FOR UPDATE', { id: appointmentId });
    if (!appt) throw new AppError('Appointment not found', 404);

    await conn.execute("UPDATE appointments SET status = 'NO_SHOW' WHERE id = :id", { id: appointmentId });
    await conn.execute("UPDATE opd_visits SET status = 'CANCELLED' WHERE appointment_id = :id", { id: appointmentId });
    await conn.execute(
      `INSERT INTO appointment_history (appointment_id, old_date, old_time, action, changed_by)
       VALUES (:id, :oldDate, :oldTime, 'NO_SHOW', :changedBy)`,
      { id: appointmentId, oldDate: appt.appointment_date, oldTime: appt.slot_time, changedBy: actorUserId }
    );
    await auditService.log(
      { userId: actorUserId, action: 'APPOINTMENT_NO_SHOW', entity: 'appointment', entityId: appointmentId },
      conn
    );
  });
}

async function listAppointments({ date = null, doctorId = null, status = null, page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  // pool.query (not execute) — see note in patientService.searchPatients
  // re: mysql2's execute()+bound-LIMIT prepared-statement bug.
  const [rows] = await pool.query(
    `SELECT a.id, a.appointment_code, a.appointment_date, a.slot_time, a.token_number, a.status,
            p.health_id, p.name AS patient_name, p.age_years, p.gender,
            u.name AS doctor_name, dept.name AS department_name,
            v.id AS visit_id, v.status AS visit_status
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN doctors d ON d.id = a.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN departments dept ON dept.id = a.department_id
     LEFT JOIN opd_visits v ON v.appointment_id = a.id
     WHERE (:date IS NULL OR a.appointment_date = :date)
       AND (:doctorId IS NULL OR a.doctor_id = :doctorId)
       AND (:status IS NULL OR a.status = :status)
     ORDER BY a.appointment_date DESC, a.token_number
     LIMIT :limit OFFSET :offset`,
    { date, doctorId, status, limit: pageSize, offset }
  );

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM appointments a
     WHERE (:date IS NULL OR a.appointment_date = :date)
       AND (:doctorId IS NULL OR a.doctor_id = :doctorId)
       AND (:status IS NULL OR a.status = :status)`,
    { date, doctorId, status }
  );

  return { rows, total, page, pageSize };
}

async function getAppointment(appointmentId) {
  const [[appt]] = await pool.execute(
    `SELECT a.*, p.health_id, p.name AS patient_name, p.age_years, p.gender, p.mobile, p.email AS patient_email,
            u.name AS doctor_name, d.consultation_fee, dept.name AS department_name,
            b.name AS branch_name, v.id AS visit_id, v.visit_code, v.status AS visit_status
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN doctors d ON d.id = a.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN departments dept ON dept.id = a.department_id
     JOIN branches b ON b.id = a.branch_id
     LEFT JOIN opd_visits v ON v.appointment_id = a.id
     WHERE a.id = :id`,
    { id: appointmentId }
  );
  if (!appt) return null;

  const [history] = await pool.execute(
    `SELECT h.*, u.name AS changed_by_name FROM appointment_history h
     JOIN users u ON u.id = h.changed_by
     WHERE h.appointment_id = :id ORDER BY h.changed_at DESC`,
    { id: appointmentId }
  );
  return { appointment: appt, history };
}

/** Today's queue, optionally scoped to one doctor (used by the doctor portal). */
async function getQueue({ date, doctorId = null, branchId = null }) {
  const [rows] = await pool.execute(
    `SELECT v.id AS visit_id, v.visit_code, v.status AS visit_status, v.checked_in_at,
            a.id AS appointment_id, a.token_number, a.slot_time, a.status AS appointment_status,
            p.id AS patient_id, p.health_id, p.name AS patient_name, p.age_years, p.gender,
            u.name AS doctor_name, d.id AS doctor_id,
            i.id AS invoice_id, i.invoice_number, i.status AS payment_status, i.net_amount
     FROM opd_visits v
     JOIN appointments a ON a.id = v.appointment_id
     JOIN patients p ON p.id = v.patient_id
     JOIN doctors d ON d.id = v.doctor_id
     JOIN users u ON u.id = d.user_id
     LEFT JOIN invoices i ON i.visit_id = v.id
     WHERE a.appointment_date = :date
       AND (:doctorId IS NULL OR v.doctor_id = :doctorId)
       AND (:branchId IS NULL OR v.branch_id = :branchId)
       AND v.status <> 'CANCELLED'
     ORDER BY CASE WHEN v.status = 'IN_CONSULTATION' THEN 0 WHEN v.status = 'CALLED' THEN 1 WHEN v.status = 'WAITING' THEN 2 ELSE 3 END, v.queue_position, a.token_number`,
    { date, doctorId, branchId }
  );
  return rows;
}

async function reorderQueue(visitId, direction, actorUserId) {
  return withTransaction(async (conn) => {
    const [[current]] = await conn.execute(
      `SELECT v.*, a.appointment_date FROM opd_visits v JOIN appointments a ON a.id=v.appointment_id
       WHERE v.id=:id FOR UPDATE`, { id: visitId }
    );
    if (!current) throw new AppError('Visit not found', 404);
    if (current.status !== 'WAITING') throw new AppError('Only waiting patients can be moved in the queue', 409);

    const [waiting] = await conn.execute(
      `SELECT v.id, v.queue_position FROM opd_visits v JOIN appointments a ON a.id=v.appointment_id
       WHERE v.doctor_id=:doctorId AND a.appointment_date=:date AND v.status='WAITING'
       ORDER BY v.queue_position, a.token_number FOR UPDATE`,
      { doctorId: current.doctor_id, date: current.appointment_date }
    );
    const index = waiting.findIndex(x => x.id === current.id);
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= waiting.length) return false;

    const other = waiting[targetIndex];
    const currentPos = current.queue_position || index + 1;
    const otherPos = other.queue_position || targetIndex + 1;
    await conn.execute('UPDATE opd_visits SET queue_position=:pos WHERE id=:id', { pos: otherPos, id: current.id });
    await conn.execute('UPDATE opd_visits SET queue_position=:pos WHERE id=:id', { pos: currentPos, id: other.id });
    await auditService.log({
      userId: actorUserId, action: 'QUEUE_REORDERED', entity: 'opd_visit', entityId: visitId,
      newValue: { direction, fromIndex:index, toIndex:targetIndex }
    }, conn);
    return true;
  });
}

/** Visit lifecycle transitions — separate from the appointment lifecycle. */
const VISIT_TRANSITIONS = {
  WAITING: ['CALLED', 'CANCELLED'],
  CALLED: ['IN_CONSULTATION', 'WAITING', 'CANCELLED'],
  IN_CONSULTATION: ['COMPLETED', 'WAITING'],
  COMPLETED: [],
  CANCELLED: []
};

async function updateVisitStatus(visitId, newStatus, actorUserId) {
  return withTransaction(async (conn) => {
    const [[visit]] = await conn.execute('SELECT * FROM opd_visits WHERE id = :id FOR UPDATE', { id: visitId });
    if (!visit) throw new AppError('Visit not found', 404);

    const allowed = VISIT_TRANSITIONS[visit.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new AppError(`Cannot change visit status from ${visit.status} to ${newStatus}`, 409);
    }

    const timestampColumn = {
      CALLED: 'called_at',
      IN_CONSULTATION: 'consultation_started_at',
      COMPLETED: 'completed_at'
    }[newStatus];

    const sql = timestampColumn
      ? `UPDATE opd_visits SET status = :status, ${timestampColumn} = NOW() WHERE id = :id`
      : 'UPDATE opd_visits SET status = :status WHERE id = :id';
    await conn.execute(sql, { status: newStatus, id: visitId });

    // Completing the visit also completes the appointment.
    if (newStatus === 'COMPLETED') {
      await conn.execute("UPDATE appointments SET status = 'COMPLETED' WHERE id = :id", {
        id: visit.appointment_id
      });
    }

    await auditService.log(
      {
        userId: actorUserId,
        action: 'VISIT_STATUS_CHANGED',
        entity: 'opd_visit',
        entityId: visitId,
        oldValue: { status: visit.status },
        newValue: { status: newStatus }
      },
      conn
    );
  });
}

module.exports = {
  calculatePregnancy,
  bookAppointment,
  rescheduleAppointment,
  updateAppointmentDetails,
  cancelAppointment,
  markNoShow,
  listAppointments,
  getAppointment,
  getQueue,
  reorderQueue,
  updateVisitStatus
};
