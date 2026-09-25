const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');
const asyncHandler = require('../utils/asyncHandler');

router.get('/', asyncHandler(publicController.home));
router.get('/patient-portal-info', publicController.patientPortalInfo);
router.get('/services', asyncHandler(publicController.services));
router.get('/our-doctors', asyncHandler(publicController.doctors));
router.get('/lab-diagnostics', publicController.labDiagnostics);
router.get('/contact', publicController.contact);
router.get('/live-opd', asyncHandler(publicController.liveOpd));
router.get('/live-opd.json', asyncHandler(publicController.liveOpdJson));

module.exports = router;
