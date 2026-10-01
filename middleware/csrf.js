const { doubleCsrf } = require('csrf-csrf');
const appConfig = require('../config/appConfig');
const authConfig = require('../config/auth');

/** CSRF protection uses session-bound tokens so a token cannot be replayed after session rotation. */
const csrfUtils = doubleCsrf({
  getSecret: () => authConfig.csrfSecret,
  getSessionIdentifier: (req) => req.session.id,
  cookieName: appConfig.isProd ? '__Host-hms.csrf' : 'hms.csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.isProd,
    path: '/'
  },
  getCsrfTokenFromRequest: (req) => {
    const bodyToken = typeof req.body?._csrf === 'string' ? req.body._csrf : null;
    const headerToken = typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : null;
    return bodyToken || headerToken;
  }
});

const doubleCsrfProtection = csrfUtils.doubleCsrfProtection;
const generate = csrfUtils.generateCsrfToken;

if (typeof generate !== 'function') {
  throw new Error(
    'csrf-csrf did not expose a token-generation function (expected generateToken or generateCsrfToken). ' +
      'Check the installed csrf-csrf version against middleware/csrf.js.'
  );
}

/** Makes the current CSRF token available to every EJS view as `csrfToken`. */
function exposeCsrfToken(req, res, next) {
  try {
    res.locals.csrfToken = generate(req, res);
  } catch (err) {
    return next(err);
  }
  next();
}

/**
 * Forces a brand-new token + cookie, discarding any existing one.
 * Call this explicitly whenever the session identity changes (login
 * success, and defensively on logout) so nothing downstream can end up
 * holding a token minted under a since-replaced session — belt-and-
 * braces on top of the getSessionIdentifier fix above.
 */
function rotateCsrfToken(req, res) {
  return generate(req, res, { overwrite: true });
}

module.exports = { csrfProtection: doubleCsrfProtection, exposeCsrfToken, rotateCsrfToken };
