const { pool } = require('../config/database');

function defaultRange() {
  const to = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 29);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

async function dailyOpdReport({ from, to, branchId = null, departmentId = null, doctorId = null }) {
  const [rows] = await pool.execute(
    `SELECT a.appointment_date AS date,
            COUNT(*) AS total_patients,
            SUM(a.status = 'COMPLETED') AS completed,
            SUM(a.status = 'CANCELLED') AS cancelled,
            SUM(a.status = 'NO_SHOW') AS no_show,
            COALESCE(SUM(pay.amount), 0) AS revenue,
            COALESCE(SUM(i.discount_amount), 0) AS discount
     FROM appointments a
     LEFT JOIN opd_visits v ON v.appointment_id = a.id
     LEFT JOIN invoices i ON i.visit_id = v.id
     LEFT JOIN payments pay ON pay.invoice_id = i.id
     WHERE a.appointment_date BETWEEN :from AND :to
       AND (:branchId IS NULL OR a.branch_id = :branchId)
       AND (:departmentId IS NULL OR a.department_id = :departmentId)
       AND (:doctorId IS NULL OR a.doctor_id = :doctorId)
     GROUP BY a.appointment_date
     ORDER BY a.appointment_date DESC`,
    { from, to, branchId, departmentId, doctorId }
  );
  return rows;
}

async function doctorReport({ from, to, branchId = null }) {
  const [rows] = await pool.execute(
    `SELECT u.name AS doctor_name, dept.name AS department_name,
            COUNT(a.id) AS total_patients,
            SUM(a.status = 'COMPLETED') AS completed,
            SUM(a.status = 'CANCELLED') AS cancelled,
            COALESCE(SUM(i.net_amount), 0) AS revenue,
            COALESCE(SUM(i.discount_amount), 0) AS discount
     FROM appointments a
     JOIN doctors d ON d.id = a.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN departments dept ON dept.id = a.department_id
     LEFT JOIN opd_visits v ON v.appointment_id = a.id
     LEFT JOIN invoices i ON i.visit_id = v.id AND i.status = 'PAID'
     WHERE a.appointment_date BETWEEN :from AND :to
       AND (:branchId IS NULL OR a.branch_id = :branchId)
     GROUP BY d.id, u.name, dept.name
     ORDER BY total_patients DESC`,
    { from, to, branchId }
  );
  return rows;
}

async function billingReport({ from, to, status = null }) {
  const [rows] = await pool.execute(
    `SELECT i.invoice_number, i.created_at, p.name AS patient_name, p.health_id,
            i.gross_amount, i.discount_amount, i.net_amount, i.status,
            (SELECT pay.method FROM payments pay WHERE pay.invoice_id = i.id ORDER BY pay.paid_at DESC LIMIT 1) AS payment_method
     FROM invoices i
     JOIN patients p ON p.id = i.patient_id
     WHERE DATE(i.created_at) BETWEEN :from AND :to
       AND (:status IS NULL OR i.status = :status)
     ORDER BY i.created_at DESC`,
    { from, to, status }
  );

  const [[totals]] = await pool.execute(
    `SELECT COALESCE(SUM(gross_amount),0) AS gross, COALESCE(SUM(discount_amount),0) AS discount,
            COALESCE(SUM(net_amount),0) AS net,
            COALESCE(SUM(net_amount * (status = 'PAID')),0) AS collected
     FROM invoices WHERE DATE(created_at) BETWEEN :from AND :to AND (:status IS NULL OR status = :status)`,
    { from, to, status }
  );

  return { rows, totals };
}

module.exports = { defaultRange, dailyOpdReport, doctorReport, billingReport };
