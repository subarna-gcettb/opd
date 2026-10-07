const auditService = require('../services/auditService');
const patientAuthService = require('../services/patientAuthService');
const AppError = require('../utils/AppError');
const { rotateCsrfToken } = require('../middleware/csrf');
const { pool } = require('../config/database');

function redirectLogin(req, res, query = '') {
  return res.redirect('/auth/login' + query);
}

function establishPatientSession(req, res, next, userId) {
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = userId;
    rotateCsrfToken(req, res);
    auditService.log({
      userId,
      action: 'LOGIN',
      entity: 'user',
      entityId: userId,
      ipAddress: req.clientIp
    }).catch(() => {});
    res.redirect('/patient-portal');
  });
}

async function requestLoginOtp(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      throw new AppError('Enter a valid email address.', 422);
    }

    const patient = await patientAuthService.findPatientUser(email);
    if (patient && patient.is_active) {
      await patientAuthService.issueOtp('LOGIN', email);
    }

    // Keep the challenge email server-side. Never put it in the URL.
    req.session.loginOtpEmail = email;
    req.session.loginOtpIssuedAt = Date.now();

    req.flash(
      'success',
      'If a patient account exists for that email, a one-time login code has been sent. The code expires in 10 minutes.'
    );

    req.session.save((err) => {
      if (err) {
        console.error('[auth] Failed to persist login OTP challenge:', err.message);
        req.flash('errors', [{ message: 'Could not start OTP verification. Please try again.' }]);
        return redirectLogin(req, res);
      }
      return redirectLogin(req, res, '?otp=1');
    });
  } catch (err) {
    req.flash('errors', [{
      message: err instanceof AppError
        ? err.message
        : 'We could not start email OTP login. Please try again.'
    }]);
    return redirectLogin(req, res);
  }
}

async function verifyLoginOtp(req, res, next) {
  try {
    const email = String(req.session.loginOtpEmail || '').trim().toLowerCase();
    const otp = String(req.body.otp || '').trim();

    if (!email) {
      throw new AppError('Your OTP login session has expired. Request a new code.', 422);
    }

    const patient = await patientAuthService.findPatientUser(email);
    if (!patient || !patient.is_active) {
      throw new AppError('The verification code is invalid or expired.', 422);
    }

    await patientAuthService.consumeOtp('LOGIN', email, otp);

    await pool.execute(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = :id',
      { id: patient.id }
    );

    delete req.session.loginOtpEmail;
    delete req.session.loginOtpIssuedAt;

    return establishPatientSession(req, res, next, patient.id);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return redirectLogin(req, res, '?otp=1');
    }
    return next(err);
  }
}

module.exports = { requestLoginOtp, verifyLoginOtp };
