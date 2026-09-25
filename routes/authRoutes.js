const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');

router.get('/login', authController.showLogin);
router.post('/login', csrfProtection, authController.login);
router.post('/logout', requireAuth, csrfProtection, authController.logout);

router.get('/reset-password', requireAuth, authController.showResetPassword);
router.post('/reset-password', requireAuth, csrfProtection, authController.resetPassword);

module.exports = router;
