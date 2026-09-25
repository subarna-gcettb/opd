const reportService = require('../services/reportService');
const { pool } = require('../config/database');

function parseRange(req) {
  const def = reportService.defaultRange();
  return { from: req.query.from || def.from, to: req.query.to || def.to };
}

async function index(req, res) {
  res.render('reports/index', { title: 'OPD Reports' });
}

async function daily(req, res, next) {
  try {
    const { from, to } = parseRange(req);
    const rows = await reportService.dailyOpdReport({
      from,
      to,
      branchId: req.query.branchId || null,
      departmentId: req.query.departmentId || null,
      doctorId: req.query.doctorId || null
    });
    const [doctors] = await pool.execute(`SELECT d.id, u.name FROM doctors d JOIN users u ON u.id = d.user_id ORDER BY u.name`);
    const [departments] = await pool.execute('SELECT id, name FROM departments ORDER BY name');
    res.render('reports/daily', { title: 'Daily OPD Report', rows, from, to, doctors, departments, filters: req.query });
  } catch (err) {
    next(err);
  }
}

async function doctorWise(req, res, next) {
  try {
    const { from, to } = parseRange(req);
    const rows = await reportService.doctorReport({ from, to, branchId: req.query.branchId || null });
    res.render('reports/doctor', { title: 'Doctor Report', rows, from, to });
  } catch (err) {
    next(err);
  }
}

async function billing(req, res, next) {
  try {
    const { from, to } = parseRange(req);
    const data = await reportService.billingReport({ from, to, status: req.query.status || null });
    res.render('reports/billing', { title: 'Billing Report', ...data, from, to, status: req.query.status || '' });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, daily, doctorWise, billing };
