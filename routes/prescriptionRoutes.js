const express = require('express');
const router = express.Router();
const prescriptionController = require('../controllers/prescriptionController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);

// Barcode scan -> authenticated patient lookup. Never a public URL.
router.get('/scan', requirePermission('patient.view'), asyncHandler(prescriptionController.scanLookup));

router.post('/', requirePermission('prescription.create'), csrfProtection, asyncHandler(prescriptionController.create));
router.get('/:id', requirePermission('patient.view', 'prescription.create'), asyncHandler(prescriptionController.view));
router.get('/:id/print', requirePermission('patient.view', 'prescription.create'), asyncHandler(prescriptionController.print));
router.post('/:id/amend', requirePermission('prescription.amend'), csrfProtection, asyncHandler(prescriptionController.amend));

module.exports = router;
