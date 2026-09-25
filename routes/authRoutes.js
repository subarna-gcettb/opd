const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');

router.get('/login', authController.showLogin);
router.post('/login', csrfProtection, authController.login);
router.post('/login/request-otp', csrfProtection, authController.requestLoginOtp);
router.get('/signup', authController.showSignup);
router.post('/signup/request-otp', csrfProtection, authController.signupRequestOtp);
router.get('/verify-signup', authController.showVerifySignup);
router.post('/verify-signup', csrfProtection, authController.verifySignup);

router.get('/forgot-password', authController.showForgotPassword);
router.post('/forgot-password/request-otp', csrfProtection, authController.requestPasswordResetOtp);
router.post('/forgot-password/reset', csrfProtection, authController.verifyPasswordReset);

router.get('/google', authController.googleStart);
router.get('/google/callback', authController.googleCallback);
router.get('/google/complete', authController.showGoogleComplete);
router.post('/google/complete', csrfProtection, authController.googleComplete);

router.post('/logout', requireAuth, csrfProtection, authController.logout);

router.get('/reset-password', requireAuth, authController.showResetPassword);
router.post('/reset-password', requireAuth, csrfProtection, authController.resetPassword);

module.exports = router;
