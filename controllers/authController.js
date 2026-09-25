const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const authConfig = require('../config/auth');
const auditService = require('../services/auditService');
const AppError = require('../utils/AppError');
const { rotateCsrfToken } = require('../middleware/csrf');

function showLogin(req, res) {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/login', { layout: 'layouts/blank', title: 'Login' });
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      req.flash('errors', [{ message: 'Email and password are required' }]);
      return res.redirect('/auth/login');
    }

    const [rows] = await pool.execute(
      `SELECT id, name, password_hash, is_active, failed_login_attempts, locked_until
       FROM users WHERE email = :email AND deleted_at IS NULL LIMIT 1`,
      { email: email.trim().toLowerCase() }
    );

    const genericFail = async () => {
      await auditService.log({
        action: 'LOGIN_FAILED',
        entity: 'user',
        newValue: { email },
        ipAddress: req.clientIp
      });
      req.flash('errors', [{ message: 'Invalid email or password' }]);
      return res.redirect('/auth/login');
    };

    if (!rows.length) return genericFail();
    const user = rows[0];

    if (!user.is_active) return genericFail();

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      req.flash('errors', [{ message: 'Account temporarily locked due to failed attempts. Try again later.' }]);
      return res.redirect('/auth/login');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const attempts = user.failed_login_attempts + 1;
      const lockUntil =
        attempts >= authConfig.maxFailedLoginAttempts
          ? new Date(Date.now() + authConfig.lockoutDurationMs)
          : null;
      await pool.execute(
        'UPDATE users SET failed_login_attempts = :attempts, locked_until = :lockUntil WHERE id = :id',
        { attempts, lockUntil, id: user.id }
      );
      return genericFail();
    }

    await pool.execute(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = :id',
      { id: user.id }
    );

    // Regenerate session on login to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      // The session id just changed — force a brand-new CSRF token/cookie
      // pair now, rather than leaving whatever was minted before login in
      // place, so the very next page render can't end up with a mismatch.
      rotateCsrfToken(req, res);
      auditService
        .log({ userId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id, ipAddress: req.clientIp })
        .catch(() => {});
      const dest = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      res.redirect(dest);
    });
  } catch (err) {
    next(err);
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

function showResetPassword(req, res) {
  res.render('auth/reset-password', { layout: 'layouts/blank', title: 'Reset Password' });
}

async function resetPassword(req, res, next) {
  try {
    const { newPassword, confirmPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters', 422);
    }
    if (newPassword !== confirmPassword) {
      throw new AppError('Passwords do not match', 422);
    }
    const hash = await bcrypt.hash(newPassword, authConfig.bcryptRounds);
    await pool.execute(
      'UPDATE users SET password_hash = :hash, must_reset_password = 0 WHERE id = :id',
      { hash, id: req.user.id }
    );
    await auditService.log({
      userId: req.user.id,
      action: 'PASSWORD_RESET',
      entity: 'user',
      entityId: req.user.id,
      ipAddress: req.clientIp
    });
    req.flash('success', 'Password updated successfully.');
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
}

module.exports = { showLogin, login, logout, showResetPassword, resetPassword };
