const multer = require('multer');
const AppError = require('../utils/AppError');
const appConfig = require('../config/appConfig');

function wantsJson(req) {
  const accept = String(req.headers.accept || '');
  return req.xhr || accept.includes('application/json') || req.path.startsWith('/api/');
}

function statusFromError(err) {
  if (Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode <= 599) {
    return err.statusCode;
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return 413;
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return 400;
    return 400;
  }
  const mysqlCodes = new Set([
    'ER_DUP_ENTRY',
    'ER_NO_REFERENCED_ROW_2',
    'ER_ROW_IS_REFERENCED_2',
    'ER_DATA_TOO_LONG',
    'ER_TRUNCATED_WRONG_VALUE',
    'ER_BAD_NULL_ERROR'
  ]);
  if (mysqlCodes.has(err.code)) return err.code === 'ER_DUP_ENTRY' ? 409 : 400;
  if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') return 503;
  if (err.code === 'EBADCSRFTOKEN') return 403;
  if (err.type === 'entity.too.large') return 413;
  if (err.type === 'entity.parse.failed' || err instanceof URIError) return 400;
  return 500;
}

function safePublicMessage(err, statusCode) {
  if (statusCode === 413) return 'The submitted request or file is too large.';
  if (statusCode === 409) return 'The requested record conflicts with existing data.';
  if (statusCode === 503) return 'The service is temporarily unavailable. Please try again shortly.';
  if (err.isOperational || statusCode < 500) return err.message || 'The request could not be completed.';
  return 'Something went wrong on our end. Please try again, and contact support if it persists.';
}

function notFoundHandler(req, res) {
  const statusCode = 404;
  if (wantsJson(req)) {
    return res.status(statusCode).json({
      error: 'The requested resource was not found.',
      status: statusCode
    });
  }

  if (res.headersSent) return;
  const homeUrl = req.user ? (req.user.patientId ? '/patient-portal' : '/dashboard') : '/';
  return res.status(statusCode).render('errors/404', {
    layout: 'layouts/blank',
    title: 'Page Not Found',
    homeUrl,
    requestedPath: req.path
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return req.socket?.destroy();
  }

  const statusCode = statusFromError(err);
  const requestId = req.requestId || null;
  const publicMessage = safePublicMessage(err, statusCode);

  if (statusCode >= 500) {
    console.error('[ERROR]', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code: err.code,
      message: err.message,
      stack: err.stack
    });
  } else {
    console.warn('[WARN]', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code: err.code,
      message: err.message
    });
  }

  if (wantsJson(req)) {
    const payload = {
      error: publicMessage,
      status: statusCode
    };
    if (requestId) payload.requestId = requestId;
    return res.status(statusCode).json(payload);
  }

  res.status(statusCode);
  if (statusCode === 401) {
    return res.render('errors/401', {
      layout: 'layouts/blank',
      title: 'Authentication Required',
      message: publicMessage
    });
  }
  if (statusCode === 403) {
    return res.render('errors/403', {
      layout: 'layouts/blank',
      title: 'Access Denied',
      message: publicMessage
    });
  }
  if (statusCode === 404) {
    return res.render('errors/404', {
      layout: 'layouts/blank',
      title: 'Page Not Found',
      homeUrl: req.user ? (req.user.patientId ? '/patient-portal' : '/dashboard') : '/',
      requestedPath: req.path
    });
  }
  return res.render('errors/500', {
    layout: 'layouts/blank',
    title: statusCode === 503 ? 'Service Unavailable' : 'Something Went Wrong',
    message: publicMessage,
    requestId,
    showDetails: !appConfig.isProd && statusCode >= 500 ? err.stack : null
  });
}

module.exports = { notFoundHandler, errorHandler, statusFromError, safePublicMessage };
