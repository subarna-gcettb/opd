const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const doctorController = require('../controllers/doctorController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requirePermissionOrRole } = require('../middleware/roles');
const { handleValidation } = require('../middleware/validation');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);

// Booking lookup APIs are read-only. AGENT role is an explicit fallback so
// stale role_permissions rows cannot break the agent cascade. The controller
// independently restricts an agent to their assigned branch for all 3 APIs.
const requireBookingLookup = requirePermissionOrRole(
  ['appointment.create', 'doctor.manage', 'agent.appointment.create'],
  ['AGENT']
);
router.get('/api/list', requireBookingLookup, asyncHandler(doctorController.doctorsByFilter));
router.get('/:id/available-dates', requireBookingLookup, asyncHandler(doctorController.availableDates));
router.get('/:id/slots', requireBookingLookup, asyncHandler(doctorController.availableSlots));

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
