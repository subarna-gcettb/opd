const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const doctorController = require('../controllers/doctorController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { handleValidation } = require('../middleware/validation');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);

// JSON helpers used by the OPD booking screen — available to anyone who
// can book an appointment, not just doctor administrators.
router.get('/api/list', requirePermission('appointment.create', 'doctor.manage'), asyncHandler(doctorController.doctorsByFilter));
router.get('/:id/available-dates', requirePermission('appointment.create', 'doctor.manage'), asyncHandler(doctorController.availableDates));
router.get('/:id/slots', requirePermission('appointment.create', 'doctor.manage'), asyncHandler(doctorController.availableSlots));

router.get('/', requirePermission('doctor.manage'), asyncHandler(doctorController.list));
router.get('/new', requirePermission('doctor.manage'), asyncHandler(doctorController.showNewForm));

router.post(
  '/new',
  requirePermission('doctor.manage'),
  csrfProtection,
  [
    body('name').trim().notEmpty().withMessage('Doctor name is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    body('temporaryPassword').isLength({ min: 8 }).withMessage('Temporary password must be at least 8 characters'),
    body('branchId').isInt().withMessage('Branch is required'),
    body('consultationFee').isFloat({ min: 0 }).withMessage('Consultation fee must be a positive number')
  ],
  handleValidation,
  asyncHandler(doctorController.create)
);

router.get('/:id', requirePermission('doctor.manage'), asyncHandler(doctorController.view));
router.post('/:id', requirePermission('doctor.manage'), csrfProtection, asyncHandler(doctorController.update));

router.post(
  '/:id/schedule',
  requirePermission('doctor.schedule.manage', 'doctor.manage'),
  csrfProtection,
  asyncHandler(doctorController.addSchedule)
);
router.post(
  '/:id/schedule/:templateId/delete',
  requirePermission('doctor.schedule.manage', 'doctor.manage'),
  csrfProtection,
  asyncHandler(doctorController.removeSchedule)
);
router.post(
  '/:id/exception',
  requirePermission('doctor.schedule.manage', 'doctor.manage'),
  csrfProtection,
  asyncHandler(doctorController.addException)
);

module.exports = router;
