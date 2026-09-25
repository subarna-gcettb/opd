const { doubleCsrf } = require('csrf-csrf');
const appConfig = require('../config/appConfig');
const authConfig = require('../config/auth');

/**
 * package.json pins "csrf-csrf": "^3.0.6", which npm resolves to 3.0.7 —
 * the last 3.x release before the 4.0.0 rename (confirmed: v4 renamed
 * generateToken -> generateCsrfToken, getTokenFromRequest ->
 * getCsrfTokenFromRequest, and made getSessionIdentifier a required
 * option). We deliberately do NOT pass getSessionIdentifier here: it is
 * not part of the confirmed v3.0.x API, and passing it previously caused
 * an "invalid csrf token" 403 immediately after login — the token/cookie
 * pair generated before login became session-bound, and
 * req.session.regenerate() on successful login (which intentionally
 * issues a new session id, to prevent session fixation) then invalidated
 * it a moment later.
 */
const csrfUtils = doubleCsrf({
  getSecret: () => authConfig.csrfSecret,
  cookieName: appConfig.isProd ? '__Host-hms.csrf' : 'hms.csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.isProd,
    path: '/'
  },
  getTokenFromRequest: (req) => req.body._csrf || req.headers['x-csrf-token']
});

const doubleCsrfProtection = csrfUtils.doubleCsrfProtection;
const generate = csrfUtils.generateToken || csrfUtils.generateCsrfToken;

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
  return generate(req, res, true);
}

module.exports = { csrfProtection: doubleCsrfProtection, exposeCsrfToken, rotateCsrfToken };
