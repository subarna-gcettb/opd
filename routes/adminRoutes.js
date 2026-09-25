const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');
const { uploadImage } = require('../utils/upload');

router.use(requireAuth);

router.get('/users', requirePermission('user.manage'), asyncHandler(adminController.listUsers));
router.post('/users', requirePermission('user.manage'), csrfProtection, asyncHandler(adminController.createUser));
router.post('/users/:id/active', requirePermission('user.manage'), csrfProtection, asyncHandler(adminController.toggleUserActive));
router.post('/users/:id/reset-password', requirePermission('user.manage'), csrfProtection, asyncHandler(adminController.resetPassword));
router.post('/users/:id/roles', requirePermission('user.manage'), csrfProtection, asyncHandler(adminController.updateRoles));

router.get('/branches', requirePermission('branch.manage'), asyncHandler(adminController.listBranches));
router.post('/branches', requirePermission('branch.manage'), csrfProtection, asyncHandler(adminController.createBranch));
router.post('/branches/:id', requirePermission('branch.manage'), csrfProtection, asyncHandler(adminController.updateBranch));

router.get('/departments', requirePermission('department.manage'), asyncHandler(adminController.listDepartments));
router.post('/departments', requirePermission('department.manage'), csrfProtection, asyncHandler(adminController.createDepartment));
router.post('/departments/:id/active', requirePermission('department.manage'), csrfProtection, asyncHandler(adminController.toggleDepartmentActive));

router.get('/audit-logs', requirePermission('audit.view'), asyncHandler(adminController.auditLogs));

router.get('/settings', requirePermission('settings.manage'), asyncHandler(adminController.showSettings));
router.post(
  '/settings',
  requirePermission('settings.manage'),
  uploadImage.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'og_image', maxCount: 1 }
  ]),
  csrfProtection,
  asyncHandler(adminController.updateSettings)
);

module.exports = router;
