const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const labService = require('../services/labService');
const AppError = require('../utils/AppError');
const { uploadDir } = require('../utils/labReportUpload');

function branchId(req) {
  if (!req.user || !req.user.branch_id) throw new AppError('A branch is required for laboratory operations', 409);
  return req.user.branch_id;
}

async function dashboard(req,res,next){try{
  const orders=await labService.listOrders(branchId(req),{});
  const stats={total:orders.length,ordered:orders.filter(x=>['ORDERED','BOOKED'].includes(x.status)).length,processing:orders.filter(x=>['SAMPLE_PENDING','PROCESSING','PARTIALLY_REPORTED'].includes(x.status)).length,reported:orders.filter(x=>x.status==='REPORTED').length,cancelled:orders.filter(x=>x.status==='CANCELLED').length};
  res.render('lab/dashboard',{title:'Laboratory & Diagnostics',orders:orders.slice(0,30),stats});
}catch(err){next(err);}}

async function orders(req,res,next){try{
  const rows=await labService.listOrders(branchId(req),{status:req.query.status||'',q:req.query.q||''});
  res.render('lab/orders',{title:'Laboratory Orders',orders:rows,filters:req.query});
}catch(err){next(err);}}

async function showNewOrder(req,res,next){try{
  let patient=null;
  if(req.query.healthId)[[patient]]=await pool.execute('SELECT id,health_id,name,mobile,gender,age_years FROM patients WHERE health_id=:healthId AND deleted_at IS NULL LIMIT 1',{healthId:String(req.query.healthId).trim()});
  const tests=await labService.getAvailableTestsForBranch(branchId(req));
  res.render('lab/new-order',{title:'New Laboratory Order',patient,tests,today:new Date().toISOString().slice(0,10)});
}catch(err){next(err);}}

async function createOrder(req,res,next){try{
  const testIds=Array.isArray(req.body.testIds)?req.body.testIds:(req.body.testIds?[req.body.testIds]:[]);
  const result=await labService.createOrder(Number(req.body.patientId),branchId(req),req.user.id,{testIds,source:req.body.source||'RECEPTION',bookingDate:req.body.bookingDate,priority:req.body.priority,clinicalNotes:req.body.clinicalNotes});
  req.flash('success','Laboratory order '+result.orderCode+' created.');
  res.redirect('/lab/orders/'+result.id);
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/orders/new');}next(err);}}

async function orderDetail(req,res,next){try{
  const data=await labService.getOrder(req.params.id); if(!data)throw new AppError('Laboratory order not found',404); if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.order.branch_id)!==Number(req.user.branch_id))throw new AppError('You do not have access to this laboratory branch',403);
  res.render('lab/order-detail',{title:data.order.order_code+' · Laboratory Order',...data});
}catch(err){next(err);}}

async function collectSample(req,res,next){try{
  const r=await labService.collectSample(req.params.itemId,req.user.id,req.body);
  req.flash('success','Sample collected. Barcode '+r.barcode+'.');res.redirect(req.get('Referer')||'/lab/orders');
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.get('Referer')||'/lab/orders');}next(err);}}

async function receiveSample(req,res,next){try{await labService.receiveSample(req.params.itemId,req.user.id);req.flash('success','Sample received by laboratory.');res.redirect(req.get('Referer')||'/lab/orders');}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.get('Referer')||'/lab/orders');}next(err);}}

async function rejectSample(req,res,next){try{await labService.rejectSample(req.params.itemId,req.user.id,req.body.reason);req.flash('success','Sample marked rejected.');res.redirect(req.get('Referer')||'/lab/orders');}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.get('Referer')||'/lab/orders');}next(err);}}

async function resultForm(req,res,next){try{
  const data=await labService.getOrder(req.params.orderId); if(!data)throw new AppError('Laboratory order not found',404);
  const item=data.items.find(x=>Number(x.id)===Number(req.params.itemId)); if(!item)throw new AppError('Laboratory test not found in this order',404);
  const result=item.result_id?await labService.getResult(item.result_id):null;
  const test=await labService.getTest(item.test_id);
  res.render('lab/result-form',{title:'Enter Result · '+item.test_name_snapshot,order:data.order,item,result,test});
}catch(err){next(err);}}

async function saveResult(req,res,next){try{
  const result=await labService.saveResult(req.params.itemId,req.user.id,{...req.body,values:req.body.values||{},remarks:req.body.remarks||{}},req.body.mode||'enter');
  req.flash('success','Result saved as version '+result.version+'.');res.redirect('/lab/results/'+result.resultId);
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.get('Referer')||'/lab/orders');}next(err);}}

async function viewResult(req,res,next){try{
  const data=await labService.getResult(req.params.id);if(!data)throw new AppError('Result not found',404);if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.result.branch_id)!==Number(req.user.branch_id))throw new AppError('You do not have access to this laboratory branch',403);
  res.render('lab/result',{title:data.result.test_name_snapshot+' · Report',...data});
}catch(err){next(err);}}

async function verifyResult(req,res,next){try{await labService.verifyResult(req.params.id,req.user.id);req.flash('success','Result verified.');res.redirect('/lab/results/'+req.params.id);}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/results/'+req.params.id);}next(err);}}
async function releaseResult(req,res,next){try{await labService.releaseResult(req.params.id,req.user.id);req.flash('success','Report released to the patient portal.');res.redirect('/lab/results/'+req.params.id);}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/results/'+req.params.id);}next(err);}}

async function attachFile(req,res,next){try{
  await labService.attachReportFile(req.params.id,req.user.id,req.file);req.flash('success','Digital report file attached.');res.redirect('/lab/results/'+req.params.id);
}catch(err){if(req.file){try{fs.unlinkSync(req.file.path);}catch(_){}}if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/results/'+req.params.id);}next(err);}}

async function printReport(req,res,next){try{
  const data=await labService.getResult(req.params.id);if(!data)throw new AppError('Report not found',404);if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.result.branch_id)!==Number(req.user.branch_id))throw new AppError('You do not have access to this laboratory branch',403);
  if(data.result.status!=='RELEASED'&&!req.user.permissions.includes('lab.result.release'))throw new AppError('Report has not been released',403);
  res.render('print/lab-report',{layout:'layouts/blank',title:'Laboratory Report',...data});
}catch(err){next(err);}}

async function downloadReportFile(req,res,next){try{
  const data=await labService.getResult(req.params.id);if(!data)throw new AppError('Report not found',404);
  if(data.result.status!=='RELEASED'&&!req.user.permissions.includes('lab.result.release'))throw new AppError('Report has not been released',403);
  if(!data.result.report_storage_path)throw new AppError('No digital report file is attached',404);
  const absolute=path.resolve(data.result.report_storage_path),root=path.resolve(uploadDir);
  if(!absolute.startsWith(root+path.sep))throw new AppError('Invalid report file path',403);
  const filename=String(data.result.report_file_name||'lab-report').replace(/["\\]/g,'');
  res.sendFile(absolute,{headers:{'Content-Disposition':'inline; filename="'+filename+'"'}});
}catch(err){next(err);}}

async function tests(req,res,next){try{
  const rows=await labService.listTests(branchId(req),{q:req.query.q||'',testType:req.query.testType||''});
  res.render('lab/tests',{title:'Laboratory Test Master',tests:rows,filters:req.query});
}catch(err){next(err);}}

async function showTestForm(req,res,next){try{
  const test=req.params.id?await labService.getTest(req.params.id):null;
  const [sections]=await pool.execute('SELECT id,name FROM lab_sections WHERE laboratory_id=(SELECT id FROM laboratories WHERE branch_id=:branchId AND is_active=1 LIMIT 1) AND is_active=1 ORDER BY name',{branchId:branchId(req)});
  const [categories]=await pool.execute('SELECT id,name FROM lab_test_categories WHERE laboratory_id=(SELECT id FROM laboratories WHERE branch_id=:branchId AND is_active=1 LIMIT 1) AND is_active=1 ORDER BY sort_order,name',{branchId:branchId(req)});
  res.render('lab/test-form',{title:test?'Edit Laboratory Test':'Add Laboratory Test',test,sections,categories});
}catch(err){next(err);}}

async function saveTest(req,res,next){try{
  let id=Number(req.params.id||0);if(id)await labService.updateTest(id,req.body,req.user.id);else id=await labService.createTest(branchId(req),req.body,req.user.id);
  await labService.saveTestParameters(id,req.body,req.user.id);
  req.flash('success','Laboratory test configuration saved.');res.redirect('/lab/tests/'+id+'/edit');
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.params.id?'/lab/tests/'+req.params.id+'/edit':'/lab/tests/new');}next(err);}}

async function cancelOrder(req,res,next){try{await labService.cancelOrder(req.params.id,req.user.id,req.body.reason,false);req.flash('success','Laboratory order cancelled.');res.redirect('/lab/orders/'+req.params.id);}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/orders/'+req.params.id);}next(err);}}

module.exports={dashboard,orders,showNewOrder,createOrder,orderDetail,collectSample,receiveSample,rejectSample,resultForm,saveResult,viewResult,verifyResult,releaseResult,attachFile,printReport,downloadReportFile,tests,showTestForm,saveTest,cancelOrder};
