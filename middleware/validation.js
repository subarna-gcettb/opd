const { validationResult } = require('express-validator');

/**
 * Runs after an array of express-validator check(...) chains.
 * On failure: re-renders the calling form (if `req.validationView` is set
 * by the route) with errors + previously entered values, or returns JSON
 * for XHR requests.
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const formatted = errors.array().map((e) => ({ field: e.path, message: e.msg }));

  if (req.xhr || (req.headers.accept || '').includes('application/json')) {
    return res.status(422).json({ errors: formatted });
  }

  req.flash('errors', formatted);
  req.flash('formData', req.body);
  return res.redirect('back');
}

module.exports = { handleValidation };
