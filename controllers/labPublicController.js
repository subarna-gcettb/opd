const { pool } = require('../config/database');
const labSmartService = require('../services/labSmartService');
const AppError = require('../utils/AppError');
const bwipjs = require('bwip-js');

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
    const shareUrl=(req.protocol+'://'+req.get('host')+req.originalUrl);
    const png=await bwipjs.toBuffer({bcid:'qrcode',text:shareUrl,scale:4,padding:1});
    const barcode=await bwipjs.toBuffer({bcid:'code128',text:data.result.order_code,scale:2,height:12,includetext:true});
    res.render('print/lab-report',{layout:'layouts/blank',title:'Laboratory Report',...data,qrDataUri:'data:image/png;base64,'+png.toString('base64'),barcodeDataUri:'data:image/png;base64,'+barcode.toString('base64'),shareUrl});
  }catch(err){next(err);}
}

module.exports={order,report};
