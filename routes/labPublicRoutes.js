const express=require('express');
const router=express.Router();
const controller=require('../controllers/labPublicController');
const asyncHandler=require('../utils/asyncHandler');

router.get('/share/:token',asyncHandler(controller.order));
router.get('/share/:token/reports/:resultId/file',asyncHandler(controller.reportFile));
router.get('/share/:token/reports/:resultId',asyncHandler(controller.report));

module.exports=router;
