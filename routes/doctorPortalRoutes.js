const express = require('express');
const router = express.Router();
const doctorPortalController = require('../controllers/doctorPortalController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);

router.get('/', requirePermission('consultation.create'), asyncHandler(doctorPortalController.dashboard));
router.get('/queue', requirePermission('consultation.create'), asyncHandler(doctorPortalController.queue));
router.post('/queue/call-next', requirePermission('consultation.create'), csrfProtection, asyncHandler(doctorPortalController.callNext));

router.get('/consultation/:visitId', requirePermission('consultation.create'), asyncHandler(doctorPortalController.consultation));
router.post('/consultation/:visitId', requirePermission('consultation.create'), csrfProtection, asyncHandler(doctorPortalController.saveConsultation));
router.post('/consultation/:visitId/complete', requirePermission('consultation.create'), csrfProtection, asyncHandler(doctorPortalController.completeVisit));

module.exports = router;
