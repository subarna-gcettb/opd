const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const patientController = require('../controllers/patientController');
const patientPortalController = require('../controllers/patientPortalController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { handleValidation } = require('../middleware/validation');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);

const registrationValidators = [
  body('name').trim().notEmpty().withMessage('Patient name is required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Gender is required'),
  body('mobile').matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit mobile number'),
  body('branchId').isInt().withMessage('Branch is required'),
  body('aadhaar').optional({ checkFalsy: true }).matches(/^\d{12}$/).withMessage('Aadhaar must be 12 digits'),
  body('altMobile').optional({ checkFalsy: true }).matches(/^[6-9]\d{9}$/).withMessage('Alternate mobile is invalid'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email address'),
  body('pinCode').optional({ checkFalsy: true }).matches(/^\d{6}$/).withMessage('PIN code must be 6 digits')
];

// Same as registration, minus branchId — branch is permanent and not editable.
const editValidators = [
  body('name').trim().notEmpty().withMessage('Patient name is required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Gender is required'),
  body('mobile').matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit mobile number'),
  body('aadhaar').optional({ checkFalsy: true }).matches(/^\d{12}$/).withMessage('Aadhaar must be 12 digits'),
  body('altMobile').optional({ checkFalsy: true }).matches(/^[6-9]\d{9}$/).withMessage('Alternate mobile is invalid'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email address'),
  body('pinCode').optional({ checkFalsy: true }).matches(/^\d{6}$/).withMessage('PIN code must be 6 digits')
];

router.get('/search', requirePermission('patient.view', 'patient.create'), asyncHandler(patientController.showSearch));
router.get(
  '/search/results',
  requirePermission('patient.view', 'patient.create'),
  asyncHandler(patientController.searchResults)
);

router.get('/new', requirePermission('patient.create'), asyncHandler(patientController.showNewForm));
router.post(
  '/new',
  requirePermission('patient.create'),
  csrfProtection,
  registrationValidators,
  handleValidation,
  asyncHandler(patientController.create)
);

router.get('/', requirePermission('patient.view'), asyncHandler(patientController.list));
router.post(
  '/:patientId/portal-account',
  requirePermission('patient.create', 'patient.edit'),
  csrfProtection,
  asyncHandler(patientPortalController.createAccount)
);
router.get('/:healthId/slip', requirePermission('patient.view'), asyncHandler(patientController.registrationSlip));
router.get('/:healthId/barcode', requirePermission('patient.view'), asyncHandler(patientController.barcodeImage));
router.get('/:healthId/edit', requirePermission('patient.edit'), asyncHandler(patientController.showEditForm));
router.post(
  '/:healthId/edit',
  requirePermission('patient.edit'),
  csrfProtection,
  editValidators,
  handleValidation,
  asyncHandler(patientController.update)
);
router.post('/:healthId/suspend', requirePermission('patient.suspend'), csrfProtection, asyncHandler(patientController.suspend));
router.post('/:healthId/restore', requirePermission('patient.suspend'), csrfProtection, asyncHandler(patientController.restore));
router.get('/:healthId', requirePermission('patient.view'), asyncHandler(patientController.profile));

module.exports = router;
