const { pool } = require('../config/database');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * All dashboard counters in a small, fixed number of queries (not one
 * query per card) — deliberately avoids N+1 patterns on the landing page.
 */
async function getDashboardStats(dateStr = todayStr()) {
  const [[apptCounts]] = await pool.execute(
    `SELECT
       COUNT(*) AS total_appointments,
       SUM(status IN ('BOOKED','RESCHEDULED')) AS upcoming_or_booked,
       SUM(status = 'COMPLETED') AS completed,
       SUM(status = 'CANCELLED') AS cancelled,
       SUM(status = 'NO_SHOW') AS no_show
     FROM appointments WHERE appointment_date = :date`,
    { date: dateStr }
  );

  const [[visitCounts]] = await pool.execute(
    `SELECT
       SUM(v.status = 'WAITING') AS waiting,
       SUM(v.status = 'IN_CONSULTATION') AS in_consultation,
       SUM(v.status = 'COMPLETED') AS completed_visits
     FROM opd_visits v
     JOIN appointments a ON a.id = v.appointment_id
     WHERE a.appointment_date = :date`,
    { date: dateStr }
  );

  const [[patientCounts]] = await pool.execute(
    `SELECT
       SUM(p.created_at >= :dateStart AND p.created_at < :dateEnd) AS new_patients,
       (SELECT COUNT(DISTINCT v.patient_id) FROM opd_visits v
        JOIN appointments a2 ON a2.id = v.appointment_id
        WHERE a2.appointment_date = :date) AS total_patients_today
     FROM patients p`,
    { date: dateStr, dateStart: `${dateStr} 00:00:00`, dateEnd: `${dateStr} 23:59:59` }
  );

  const [[revenue]] = await pool.execute(
    `SELECT COALESCE(SUM(amount), 0) AS today_revenue
     FROM payments WHERE DATE(paid_at) = :date`,
    { date: dateStr }
  );

  const [[{ pending_discounts }]] = await pool.execute(
    "SELECT COUNT(*) AS pending_discounts FROM discount_requests WHERE status = 'PENDING'"
  );

  const newPatients = Number(patientCounts.new_patients) || 0;
  const totalPatientsToday = Number(patientCounts.total_patients_today) || 0;

  return {
    todaysOpdPatients: totalPatientsToday,
    newPatientsToday: newPatients,
    returningPatientsToday: Math.max(0, totalPatientsToday - newPatients),
    todaysAppointments: Number(apptCounts.total_appointments) || 0,
    waitingPatients: Number(visitCounts.waiting) || 0,
    completedConsultations: Number(visitCounts.completed_visits) || 0,
    cancelledAppointments: Number(apptCounts.cancelled) || 0,
    noShow: Number(apptCounts.no_show) || 0,
    todaysRevenue: Number(revenue.today_revenue) || 0,
    pendingDiscountRequests: Number(pending_discounts) || 0
  };
}

/** Small trailing 7-day trend for the dashboard chart (single query). */
async function getWeeklyTrend() {
  const [rows] = await pool.execute(
    `SELECT DATE(a.appointment_date) AS d, COUNT(*) AS cnt
     FROM appointments a
     WHERE a.appointment_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(a.appointment_date)
     ORDER BY d`
  );
  return rows;
}

module.exports = { getDashboardStats, getWeeklyTrend, todayStr };
