const express = require('express');
const router = express.Router();
const scanController = require('../controllers/scanController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);
router.get(
  '/',
  requirePermission('patient.view', 'queue.manage', 'consultation.create', 'billing.view'),
  asyncHandler(scanController.resolve)
);

module.exports = router;
