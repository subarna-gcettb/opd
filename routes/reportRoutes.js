const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);
router.use(requirePermission('report.view'));

router.get('/', asyncHandler(reportController.index));
router.get('/daily', asyncHandler(reportController.daily));
router.get('/doctor', asyncHandler(reportController.doctorWise));
router.get('/billing', asyncHandler(reportController.billing));

module.exports = router;
