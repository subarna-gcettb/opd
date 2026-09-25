const appConfig = require('../config/appConfig');

function notFoundHandler(req, res) {
  res.status(404);
  if ((req.headers.accept || '').includes('application/json')) {
    return res.json({ error: 'Not found' });
  }
  res.render('errors/404', { layout: 'layouts/blank', title: 'Not Found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  // Log full detail server-side only. Never send stack traces, SQL text,
  // credentials, or filesystem paths to the client.
  if (statusCode >= 500) {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}`, err);
  } else {
    console.warn(`[WARN] ${req.method} ${req.originalUrl} - ${err.message}`);
  }

  const publicMessage =
    err.isOperational || statusCode < 500
      ? err.message
      : 'Something went wrong on our end. Please try again, and contact support if it persists.';

  if ((req.headers.accept || '').includes('application/json') || req.xhr) {
    return res.status(statusCode).json({ error: publicMessage });
  }

  res.status(statusCode);
  if (statusCode === 403) {
    return res.render('errors/403', { layout: 'layouts/blank', title: 'Access Denied', message: publicMessage });
  }
  res.render('errors/500', {
    layout: 'layouts/blank',
    title: 'Error',
    message: publicMessage,
    showDetails: !appConfig.isProd ? err.stack : null
  });
}

module.exports = { notFoundHandler, errorHandler };
