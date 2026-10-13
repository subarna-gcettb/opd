const { pool } = require('../config/database');
const labSmartService = require('../services/labSmartService');
const AppError = require('../utils/AppError');

async function order(req,res,next){
  try{
    const data=await labSmartService.getPublicOrder(req.params.token);
    if(!data)throw new AppError('This secure laboratory link has expired or is invalid.',404);
    res.render('lab/public-order',{layout:'layouts/blank',title:'Laboratory Report Status',...data,token:req.params.token});
  }catch(err){next(err);}
}

async function report(req,res,next){
  try{
    const data=await labSmartService.getPublicReport(req.params.token,req.params.resultId);
    if(!data)throw new AppError('Released report not found or secure link expired.',404);
    res.render('print/lab-report',{layout:'layouts/blank',title:'Laboratory Report',...data});
  }catch(err){next(err);}
}

module.exports={order,report};
