module.exports = {
  appName: process.env.APP_NAME || 'Chhayabithi Hospital Management System',
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  session: {
    secret: process.env.SESSION_SECRET,
    maxAgeMs: Number(process.env.SESSION_MAX_AGE_MS) || 8 * 60 * 60 * 1000
  },

  rateLimit: {
    loginMax: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
    loginWindowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000
  },

  pagination: {
    defaultPageSize: 20,
    maxPageSize: 100
  },

  // Roles known to the system (also seeded in DB). Kept here only for
  // readable references in code — the DB is always the source of truth
  // for actual permission checks.
  roles: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    OPD_STAFF: 'OPD_STAFF',
    DOCTOR: 'DOCTOR'
  }
};
