const { pool } = require('../config/database');
const settingsService = require('../services/settingsService');
const liveOpdService = require('../services/liveOpdService');

async function home(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  try {
    const [liveSummary, [doctors], [departments]] = await Promise.all([
      liveOpdService.getPublicSummary(),
      pool.execute(
        `SELECT u.name, d.specialisation, d.qualification, dept.name AS department_name
         FROM doctors d JOIN users u ON u.id = d.user_id
         LEFT JOIN departments dept ON dept.id = d.department_id
         WHERE d.deleted_at IS NULL AND d.is_active = 1 ORDER BY u.name LIMIT 6`
      ),
      pool.execute('SELECT name FROM departments WHERE is_active = 1 ORDER BY name LIMIT 8')
    ]);
    res.render('public/home', {
      layout: 'layouts/landing',
      title: 'Welcome',
      currentPage: 'home',
      liveSummary,
      doctors,
      departments
    });
  } catch (err) {
    next(err);
  }
}

function patientPortalInfo(req, res) {
  res.render('public/patient-portal-info', { layout: 'layouts/landing', title: 'Patient Portal', currentPage: 'patient-portal' });
}

async function services(req, res, next) {
  try {
    const [departments] = await pool.execute('SELECT name FROM departments WHERE is_active = 1 ORDER BY name');
    res.render('public/services', { layout: 'layouts/landing', title: 'Services', currentPage: 'services', departments });
  } catch (err) {
    next(err);
  }
}

async function doctors(req, res, next) {
  try {
    const [doctors] = await pool.execute(
      `SELECT u.name, d.specialisation, d.qualification, d.experience_years, dept.name AS department_name
       FROM doctors d JOIN users u ON u.id = d.user_id
       LEFT JOIN departments dept ON dept.id = d.department_id
       WHERE d.deleted_at IS NULL AND d.is_active = 1 ORDER BY u.name`
    );
    res.render('public/doctors', { layout: 'layouts/landing', title: 'Our Doctors', currentPage: 'doctors', doctors });
  } catch (err) {
    next(err);
  }
}

function labDiagnostics(req, res) {
  res.render('public/lab-diagnostics', { layout: 'layouts/landing', title: 'Lab & Diagnostics', currentPage: 'lab' });
}

function contact(req, res) {
  res.render('public/contact', { layout: 'layouts/landing', title: 'Contact', currentPage: 'contact' });
}

async function liveOpd(req, res, next) {
  try {
    const settings = await settingsService.getSettings();
    const showNames = settings.live_opd_show_names === '1';
    const date = liveOpdService.todayStr();
    const [summary, board] = await Promise.all([
      liveOpdService.getPublicSummary(date),
      liveOpdService.getPublicBoard(date, showNames)
    ]);
    res.render('public/live-opd', {
      layout: 'layouts/landing',
      title: 'Live OPD',
      currentPage: 'live-opd',
      summary,
      board,
      showNames
    });
  } catch (err) {
    next(err);
  }
}

/** JSON used by both the home widget and the live-opd page for auto-refresh. */
async function liveOpdJson(req, res, next) {
  try {
    const settings = await settingsService.getSettings();
    const showNames = settings.live_opd_show_names === '1';
    const date = liveOpdService.todayStr();
    const [summary, board] = await Promise.all([
      liveOpdService.getPublicSummary(date),
      liveOpdService.getPublicBoard(date, showNames)
    ]);
    res.json({ summary, board });
  } catch (err) {
    next(err);
  }
}

module.exports = { home, patientPortalInfo, services, doctors, labDiagnostics, contact, liveOpd, liveOpdJson };
