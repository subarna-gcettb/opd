const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const opdController = require('../controllers/opdController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { handleValidation } = require('../middleware/validation');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);

router.get('/queue', requirePermission('queue.manage'), asyncHandler(opdController.queue));
router.get('/visits/:visitId/vitals', requirePermission('queue.manage'), asyncHandler(opdController.showVitals));
router.post('/visits/:visitId/vitals', requirePermission('queue.manage'), csrfProtection, asyncHandler(opdController.saveVitals));
router.get('/live-board', requirePermission('queue.manage', 'consultation.create'), asyncHandler(opdController.liveBoard));
router.post(
  '/visits/:visitId/status',
  requirePermission('queue.manage'),
  csrfProtection,
  asyncHandler(opdController.updateVisitStatus)
);

router.get('/appointments/new', requirePermission('appointment.create'), asyncHandler(opdController.showBookingForm));
router.post(
  '/appointments/new',
  requirePermission('appointment.create'),
  csrfProtection,
  [
    body('patientId').isInt().withMessage('Select a patient'),
    body('doctorId').isInt().withMessage('Select a doctor'),
    body('branchId').isInt().withMessage('Select a branch'),
    body('departmentId').isInt().withMessage('Select a department'),
    body('appointmentDate').isISO8601().withMessage('Select a valid date'),
    body('slotTime').matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('Select a time slot')
  ],
  handleValidation,
  asyncHandler(opdController.book)
);

router.get('/appointments', requirePermission('appointment.create', 'queue.manage'), asyncHandler(opdController.listAppointments));
router.get('/appointments/:id', requirePermission('appointment.create', 'queue.manage'), asyncHandler(opdController.viewAppointment));
router.get('/appointments/:id/barcode', requirePermission('appointment.create', 'patient.view'), asyncHandler(opdController.appointmentBarcode));
router.get('/appointments/:id/token', requirePermission('appointment.create', 'queue.manage'), asyncHandler(opdController.printToken));

router.post(
  '/appointments/:id/reschedule',
  requirePermission('appointment.reschedule'),
  csrfProtection,
  asyncHandler(opdController.reschedule)
);
router.post(
  '/appointments/:id/cancel',
  requirePermission('appointment.cancel', 'appointment.reschedule'),
  csrfProtection,
  asyncHandler(opdController.cancel)
);
router.post(
  '/appointments/:id/no-show',
  requirePermission('queue.manage'),
  csrfProtection,
  asyncHandler(opdController.noShow)
);

module.exports = router;
