const { pool } = require('../config/database');

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());
}

/**
 * Public, unauthenticated summary — aggregate counts ONLY, never a
 * patient name or any identifying detail. This is what the landing
 * page's "Live OPD" section is allowed to show; the detailed,
 * patient-identifying board (getStaffBoard) is staff/doctor-only.
 */
async function getPublicSummary(date = todayStr()) {
  const [[row]] = await pool.execute(
    `SELECT
       COUNT(DISTINCT v.doctor_id) AS doctors_active,
       SUM(v.status = 'IN_CONSULTATION') AS in_consultation,
       SUM(v.status = 'WAITING') AS waiting,
       COUNT(*) AS total_visits
     FROM opd_visits v
     JOIN appointments a ON a.id = v.appointment_id
     WHERE a.appointment_date = :date AND v.status <> 'CANCELLED'`,
    { date }
  );
  return {
    doctorsActive: Number(row.doctors_active) || 0,
    inConsultation: Number(row.in_consultation) || 0,
    waiting: Number(row.waiting) || 0,
    totalVisitsToday: Number(row.total_visits) || 0
  };
}

/**
 * Full staff/doctor-facing live board: every doctor scheduled today,
 * whether they're actually present (per schedule + leave exceptions),
 * whether they're currently seeing a patient, who that patient is and
 * their token, and the live queue length. Contains patient names —
 * authenticated + permission-gated routes only.
 */
async function getStaffBoard(date = todayStr()) {
  const weekday = new Date(`${date}T00:00:00`).getDay();

  const [scheduledDoctors] = await pool.execute(
    `SELECT DISTINCT d.id AS doctor_id, u.name AS doctor_name, dept.name AS department_name,
            dst.start_time, dst.end_time
     FROM doctor_schedule_templates dst
     JOIN doctors d ON d.id = dst.doctor_id AND d.deleted_at IS NULL AND d.is_active = 1
     JOIN users u ON u.id = d.user_id
     LEFT JOIN departments dept ON dept.id = d.department_id
     WHERE dst.weekday = :weekday AND dst.is_active = 1
     ORDER BY dept.name, u.name`,
    { weekday }
  );

  const [exceptions] = await pool.execute(
    `SELECT doctor_id, is_unavailable, start_time, end_time, reason
     FROM doctor_schedule_exceptions WHERE exception_date = :date`,
    { date }
  );
  const exceptionMap = new Map(exceptions.map((e) => [e.doctor_id, e]));

  const [visits] = await pool.execute(
    `SELECT v.id AS visit_id, v.doctor_id, v.status AS visit_status,
            a.token_number, a.slot_time, v.queue_position,
            p.name AS patient_name, p.health_id
     FROM opd_visits v
     JOIN appointments a ON a.id = v.appointment_id
     JOIN patients p ON p.id = v.patient_id
     WHERE a.appointment_date = :date AND v.status <> 'CANCELLED'
     ORDER BY v.doctor_id, CASE WHEN v.status = 'IN_CONSULTATION' THEN 0 WHEN v.status = 'CALLED' THEN 1 WHEN v.status = 'WAITING' THEN 2 ELSE 3 END, v.queue_position, a.token_number`,
    { date }
  );

  const visitsByDoctor = new Map();
  visits.forEach((v) => {
    if (!visitsByDoctor.has(v.doctor_id)) visitsByDoctor.set(v.doctor_id, []);
    visitsByDoctor.get(v.doctor_id).push(v);
  });

  return scheduledDoctors.map((doc) => {
    const exception = exceptionMap.get(doc.doctor_id);
    const isOnLeave = exception && exception.is_unavailable;
    const doctorVisits = visitsByDoctor.get(doc.doctor_id) || [];
    const current = doctorVisits.find((v) => v.visit_status === 'IN_CONSULTATION');
    const waitingCount = doctorVisits.filter((v) => v.visit_status === 'WAITING').length;
    const calledCount = doctorVisits.filter((v) => v.visit_status === 'CALLED').length;
    const nextInQueue = doctorVisits.filter((v) => v.visit_status === 'WAITING').slice(0, 3);

    return {
      doctorId: doc.doctor_id,
      doctorName: doc.doctor_name,
      departmentName: doc.department_name,
      scheduledHours: `${String(doc.start_time).slice(0, 5)} – ${String(doc.end_time).slice(0, 5)}`,
      isPresent: !isOnLeave,
      leaveReason: isOnLeave ? exception.reason : null,
      inChamber: Boolean(current),
      currentPatientName: current ? current.patient_name : null,
      currentToken: current ? current.token_number : null,
      waitingCount,
      calledCount,
      nextInQueue: nextInQueue.map((v) => ({ token: v.token_number, name: v.patient_name }))
    };
  });
}

/**
 * Public-facing live board — same shape as getStaffBoard, but with
 * patient names stripped unless showNames is true (driven by the
 * live_opd_show_names site setting, since this page has no auth wall).
 */
async function getPublicBoard(date, showNames) {
  const board = await getStaffBoard(date);
  if (showNames) return board;
  return board.map((d) => ({
    ...d,
    currentPatientName: d.inChamber ? 'Patient in consultation' : null,
    nextInQueue: d.nextInQueue.map((n) => ({ token: n.token, name: null }))
  }));
}

module.exports = { getPublicSummary, getStaffBoard, getPublicBoard, todayStr };
