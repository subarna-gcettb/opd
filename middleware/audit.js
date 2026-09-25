/** Resolves the best-effort client IP, respecting a trusted reverse proxy. */
function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    null
  );
}

/** Attaches req.clientIp for use by controllers/services when logging. */
function attachClientIp(req, res, next) {
  req.clientIp = getClientIp(req);
  next();
}

module.exports = { getClientIp, attachClientIp };
