const { pool } = require('../config/database');

/**
 * Loads the current user (with roles + permissions) onto req.user for
 * every request that has a valid session. Does NOT reject unauthenticated
 * requests — use requireAuth for that. Mounted globally so views can
 * always check `res.locals.currentUser`.
 */
async function attachUser(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      res.locals.currentUser = null;
      return next();
    }

    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.branch_id, u.patient_id, u.must_reset_password, u.is_active
       FROM users u WHERE u.id = :id AND u.deleted_at IS NULL LIMIT 1`,
      { id: req.session.userId }
    );

    if (!rows.length || !rows[0].is_active) {
      req.session.destroy(() => {});
      res.locals.currentUser = null;
      return next();
    }

    const user = rows[0];

    const [roleRows] = await pool.execute(
      `SELECT r.code FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = :id`,
      { id: user.id }
    );
    const roleCodes = roleRows.map((r) => r.code);

    const [permRows] = await pool.execute(
      `SELECT DISTINCT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = :id`,
      { id: user.id }
    );
    const permissionCodes = permRows.map((p) => p.code);

    // If this user is also a doctor, resolve their doctor_id so
    // doctor-scoped queries elsewhere can filter by it directly.
    const [doctorRows] = await pool.execute(
      'SELECT id FROM doctors WHERE user_id = :id AND deleted_at IS NULL LIMIT 1',
      { id: user.id }
    );

    req.user = {
      ...user,
      roles: roleCodes,
      permissions: permissionCodes,
      doctorId: doctorRows.length ? doctorRows[0].id : null,
      // Patient-portal accounts have users.patient_id set. Every
      // patient-portal route derives its data scope from THIS value
      // alone — never from a request parameter — which is what
      // prevents one patient from viewing another patient's records
      // by guessing an id in the URL.
      patientId: user.patient_id || null
    };
    res.locals.currentUser = req.user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Rejects the request unless a valid session user is attached. */
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  // req.path is relative to the mount point of whichever router is
  // currently handling the request (e.g. inside authRoutes, mounted at
  // '/auth', a request to '/auth/reset-password' sees req.path as just
  // '/reset-password'). req.originalUrl stays absolute no matter which
  // router/middleware layer reads it, which is what this comparison
  // actually needs — comparing against req.path here previously caused
  // an infinite redirect loop on first login (the reset-password page
  // itself kept redirecting to reset-password).
  const currentPath = req.originalUrl.split('?')[0];
  if (req.user.must_reset_password && currentPath !== '/auth/reset-password') {
    return res.redirect('/auth/reset-password');
  }
  next();
}

module.exports = { attachUser, requireAuth };
