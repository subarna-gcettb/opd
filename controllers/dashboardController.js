const dashboardService = require('../services/dashboardService');

async function index(req, res, next) {
  try {
    // Patient-portal accounts have nothing to do on the staff dashboard —
    // route them straight to their own portal instead.
    if (req.user.patientId) {
      return res.redirect('/patient-portal');
    }
    const date = req.query.date || dashboardService.todayStr();
    const [stats, trend] = await Promise.all([
      dashboardService.getDashboardStats(date),
      dashboardService.getWeeklyTrend()
    ]);
    res.render('dashboard/index', { title: 'Dashboard', stats, trend, date });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };
