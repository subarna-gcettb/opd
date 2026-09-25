const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/database');
const authConfig = require('../config/auth');
const auditService = require('../services/auditService');
const patientAuthService = require('../services/patientAuthService');
const emailService = require('../services/emailService');
const AppError = require('../utils/AppError');
const { rotateCsrfToken } = require('../middleware/csrf');

function showLogin(req, res) {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/login', { layout: 'layouts/blank', title: 'Login' });
}

function showSignup(req, res) {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/signup', { layout: 'layouts/blank', title: 'Patient Sign Up' });
}

function showVerifySignup(req, res) {
  res.render('auth/verify-signup', { layout: 'layouts/blank', title: 'Verify Email', email: req.session.signupEmail || '' });
}

function showForgotPassword(req, res) {
  res.render('auth/forgot-password', { layout: 'layouts/blank', title: 'Forgot Password' });
}

function showResetPassword(req, res) {
  if (!req.user) return res.redirect('/auth/login');
  res.render('auth/reset-password', { layout: 'layouts/blank', title: 'Reset Password' });
}

async function login(req, res, next) {
  try {
    const { identifier, password, email, otp } = req.body;
    const key = (identifier || email || '').trim();

    if (otp && key.includes('@')) {
      await patientAuthService.consumeOtp('LOGIN', key, otp);
      const patientUser = await patientAuthService.findPatientUser(key);
      if (!patientUser || !patientUser.is_active) throw new AppError('Invalid patient account', 401);
      return establishSession(req, res, next, patientUser.id, '/patient-portal');
    }

    if (!key || !password) {
      req.flash('errors', [{ message: 'Enter your email, phone number, or Health ID and password.' }]);
      return res.redirect('/auth/login');
    }

    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.password_hash, u.email, u.mobile, u.is_active, u.failed_login_attempts, u.locked_until,
              u.patient_id, p.health_id
       FROM users u
       LEFT JOIN patients p ON p.id = u.patient_id
       WHERE u.deleted_at IS NULL
         AND (LOWER(u.email) = LOWER(:key) OR u.mobile = :key OR p.health_id = :key)
       LIMIT 1`,
      { key }
    );

    const user = rows[0];
    if (!user || !user.is_active) return genericFail(req, res, key);
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      req.flash('errors', [{ message: 'Account temporarily locked. Try again later.' }]);
      return res.redirect('/auth/login');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const attempts = Number(user.failed_login_attempts || 0) + 1;
      const lockUntil = attempts >= authConfig.maxFailedLoginAttempts
        ? new Date(Date.now() + authConfig.lockoutDurationMs) : null;
      await pool.execute(
        'UPDATE users SET failed_login_attempts = :attempts, locked_until = :lockUntil WHERE id = :id',
        { attempts, lockUntil, id: user.id }
      );
      return genericFail(req, res, key);
    }

    await pool.execute(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = :id',
      { id: user.id }
    );

    const patientDest = user.patient_id ? '/patient-portal' : '/dashboard';
    return establishSession(req, res, next, user.id, patientDest);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/auth/login');
    }
    next(err);
  }
}

async function requestLoginOtp(req, res, next) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const patient = await patientAuthService.findPatientUser(email);
    if (!patient) throw new AppError('No patient account was found for this email address', 404);
    await patientAuthService.issueOtp('LOGIN', email);
    req.flash('success', 'A one-time login code has been sent to your email.');
    res.redirect('/auth/login?otp=1&email=' + encodeURIComponent(email));
  } catch (err) {
    req.flash('errors', [{ message: err.message }]);
    res.redirect('/auth/login');
  }
}

async function signupRequestOtp(req, res, next) {
  try {
    const password = String(req.body.password || '');
    if (password.length < 8) throw new AppError('Password must be at least 8 characters', 422);
    if (password !== req.body.confirmPassword) throw new AppError('Passwords do not match', 422);
    if (!/^[6-9]\d{9}$/.test(req.body.mobile || '')) throw new AppError('Enter a valid 10-digit mobile number', 422);
    if (!['Male','Female','Other'].includes(req.body.gender)) throw new AppError('Select a valid gender', 422);

    const email = String(req.body.email || '').trim().toLowerCase();
    const [[exists]] = await pool.execute('SELECT id FROM users WHERE email = :email AND deleted_at IS NULL LIMIT 1', { email });
    if (exists) throw new AppError('An account with this email already exists', 409);

    const passwordHash = await bcrypt.hash(password, authConfig.bcryptRounds);
    const payload = { ...req.body, email, passwordHash, password: undefined, confirmPassword: undefined };
    await patientAuthService.issueOtp('SIGNUP', email, payload);
    req.session.signupEmail = email;
    req.flash('success', 'We sent a verification code to your email.');
    res.redirect('/auth/verify-signup');
  } catch (err) {
    req.flash('errors', [{ message: err.message }]);
    res.redirect('/auth/signup');
  }
}

async function verifySignup(req, res, next) {
  try {
    const email = String(req.body.email || req.session.signupEmail || '').trim().toLowerCase();
    const record = await patientAuthService.consumeOtp('SIGNUP', email, req.body.otp);
    const payload = JSON.parse(record.payload || '{}');
    if (!payload.name || !payload.mobile || !payload.passwordHash) throw new AppError('Signup session is incomplete. Please start again.', 422);
    const patient = await patientAuthService.createPatientFromSignup(payload);
    delete req.session.signupEmail;
    req.flash('success', `Account created successfully. Your Health ID is ${patient.healthId}. You can now sign in.`);
    res.redirect('/auth/login');
  } catch (err) {
    req.flash('errors', [{ message: err.message }]);
    res.redirect('/auth/verify-signup');
  }
}

async function requestPasswordResetOtp(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const patient = await patientAuthService.findPatientUser(email);
    if (!patient) throw new AppError('No patient account was found for this email address', 404);
    await patientAuthService.issueOtp('PASSWORD_RESET', email);
    req.session.resetEmail = email;
    req.flash('success', 'A password-reset code has been sent to your email.');
    res.redirect('/auth/forgot-password?step=verify');
  } catch (err) {
    req.flash('errors', [{ message: err.message }]);
    res.redirect('/auth/forgot-password');
  }
}

async function resetPassword(req, res, next) {
  try {
    const { newPassword, confirmPassword } = req.body;
    if (!newPassword || newPassword.length < 8) throw new AppError('Password must be at least 8 characters', 422);
    if (newPassword !== confirmPassword) throw new AppError('Passwords do not match', 422);
    const hash = await bcrypt.hash(newPassword, authConfig.bcryptRounds);
    await pool.execute('UPDATE users SET password_hash = :hash, must_reset_password = 0 WHERE id = :id', { hash, id: req.user.id });
    await auditService.log({ userId: req.user.id, action: 'PASSWORD_RESET', entity: 'user', entityId: req.user.id, ipAddress: req.clientIp });
    req.flash('success', 'Password updated successfully.');
    res.redirect(req.user.patientId ? '/patient-portal' : '/dashboard');
  } catch (err) { next(err); }
}

async function verifyPasswordReset(req, res) {
  try {
    const email = String(req.body.email || req.session.resetEmail || '').trim().toLowerCase();
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8) throw new AppError('Password must be at least 8 characters', 422);
    if (newPassword !== req.body.confirmPassword) throw new AppError('Passwords do not match', 422);
    await patientAuthService.consumeOtp('PASSWORD_RESET', email, req.body.otp);
    const hash = await bcrypt.hash(newPassword, authConfig.bcryptRounds);
    const patient = await patientAuthService.findPatientUser(email);
    if (!patient) throw new AppError('Patient account not found', 404);
    await pool.execute(
      'UPDATE users SET password_hash = :hash, must_reset_password = 0, failed_login_attempts = 0, locked_until = NULL WHERE id = :id',
      { hash, id: patient.id }
    );
    delete req.session.resetEmail;
    req.flash('success', 'Password reset successfully. You can now sign in.');
    res.redirect('/auth/login');
  } catch (err) {
    req.flash('errors', [{ message: err.message }]);
    res.redirect('/auth/forgot-password?step=verify');
  }
}

function googleStart(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/google/callback`;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    req.flash('errors', [{ message: 'Google Sign-In is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' }]);
    return res.redirect('/auth/login');
  }
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleOAuthState = state;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    state
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
}

async function googleCallback(req, res, next) {
  try {
    if (!req.query.code || !req.query.state || req.query.state !== req.session.googleOAuthState) {
      throw new AppError('Google sign-in could not be verified', 400);
    }
    delete req.session.googleOAuthState;

    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokens.access_token) throw new AppError('Google authorization failed', 401);

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token }
    });
    const googleUser = await userResponse.json();
    if (!googleUser.email || !googleUser.email_verified) throw new AppError('Google account email is not verified', 401);

    const [rows] = await pool.execute('SELECT id, patient_id, is_active FROM users WHERE email = :email AND deleted_at IS NULL LIMIT 1', { email: googleUser.email.toLowerCase() });
    if (rows.length && rows[0].is_active) {
      return establishSession(req, res, next, rows[0].id, rows[0].patient_id ? '/patient-portal' : '/dashboard');
    }

    req.session.googlePending = { email: googleUser.email.toLowerCase(), name: googleUser.name || googleUser.given_name || 'Patient' };
    res.redirect('/auth/google/complete');
  } catch (err) {
    req.flash('errors', [{ message: err.message }]);
    res.redirect('/auth/login');
  }
}

function showGoogleComplete(req, res) {
  if (!req.session.googlePending) return res.redirect('/auth/login');
  res.render('auth/google-complete', { layout: 'layouts/blank', title: 'Complete Patient Sign Up', googlePending: req.session.googlePending });
}

async function googleComplete(req, res) {
  try {
    const pending = req.session.googlePending;
    if (!pending) throw new AppError('Google signup session expired. Please try again.', 400);
    if (!['Male','Female','Other'].includes(req.body.gender)) throw new AppError('Select a valid gender', 422);
    if (!/^[6-9]\d{9}$/.test(req.body.mobile || '')) throw new AppError('Enter a valid 10-digit mobile number', 422);
    const [[exists]] = await pool.execute('SELECT id FROM users WHERE email = :email AND deleted_at IS NULL LIMIT 1', { email: pending.email });
    if (exists) throw new AppError('An account already exists with this email', 409);

    const password = crypto.randomBytes(18).toString('base64url') + 'A1!';
    const passwordHash = await bcrypt.hash(password, authConfig.bcryptRounds);
    const patient = await patientAuthService.createPatientFromSignup({
      name: pending.name,
      email: pending.email,
      mobile: req.body.mobile,
      gender: req.body.gender,
      passwordHash
    });
    delete req.session.googlePending;
    const [[user]] = await pool.execute('SELECT id FROM users WHERE email = :email LIMIT 1', { email: pending.email });
    req.flash('success', `Google signup complete. Your Health ID is ${patient.healthId}.`);
    return establishSession(req, res, next, user.id, '/patient-portal');
  } catch (err) {
    req.flash('errors', [{ message: err.message }]);
    res.redirect('/auth/google/complete');
  }
}

function logout(req, res, next) {
  const userId = req.user ? req.user.id : null;
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('hms.sid');
    rotateCsrfToken(req, res);
    if (userId) auditService.log({ userId, action: 'LOGOUT', entity: 'user', entityId: userId }).catch(() => {});
    res.redirect('/auth/login');
  });
}

async function genericFail(req, res, key) {
  await auditService.log({ action: 'LOGIN_FAILED', entity: 'user', newValue: { identifier: key }, ipAddress: req.clientIp });
  req.flash('errors', [{ message: 'Invalid login credentials' }]);
  return res.redirect('/auth/login');
}

function establishSession(req, res, next, userId, destination) {
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = userId;
    rotateCsrfToken(req, res);
    auditService.log({ userId, action: 'LOGIN', entity: 'user', entityId: userId, ipAddress: req.clientIp }).catch(() => {});
    res.redirect(destination);
  });
}

module.exports = {
  showLogin,
  login,
  logout,
  showResetPassword,
  resetPassword,
  showSignup,
  showVerifySignup,
  signupRequestOtp,
  verifySignup,
  requestLoginOtp,
  requestPasswordResetOtp,
  verifyPasswordReset,
  googleStart,
  googleCallback,
  showGoogleComplete,
  googleComplete
};
