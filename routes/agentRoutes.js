const express=require('express');
const router=express.Router();
const controller=require('../controllers/agentController');
const { requireAuth }=require('../middleware/auth');
const { requireRole }=require('../middleware/roles');
const { csrfProtection }=require('../middleware/csrf');
const asyncHandler=require('../utils/asyncHandler');

router.use(requireAuth);

// Agent portal actions are role-scoped. The Agent role is provisioned with
// the corresponding permissions by the schema repair/role bootstrap, but
// route access must not depend on stale permission rows in a production DB.
const requireAgent=requireRole('AGENT');

router.get('/',requireAgent,asyncHandler(controller.dashboard));
router.get('/patients',requireAgent,asyncHandler(controller.patients));
router.get('/patients/new',requireAgent,asyncHandler(controller.newPatient));
router.post('/patients',requireAgent,csrfProtection,asyncHandler(controller.createPatient));
router.get('/opd/new',requireAgent,asyncHandler(controller.opdForm));
router.get('/api/patients',requireAgent,asyncHandler(controller.searchPatients));
router.post('/opd',requireAgent,csrfProtection,asyncHandler(controller.bookOpd));
router.get('/tests/new',requireAgent,asyncHandler(controller.testForm));
router.post('/tests',requireAgent,csrfProtection,asyncHandler(controller.bookTest));
router.get('/referrals',requireAgent,asyncHandler(controller.referrals));

module.exports=router;
