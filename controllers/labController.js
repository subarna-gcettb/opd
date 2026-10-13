const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const labService = require('../services/labService');
const labSmartService = require('../services/labSmartService');
const emailService = require('../services/emailService');
const bwipjs = require('bwip-js');
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
  const packages=await labSmartService.listPackages(branchId(req));
  res.render('lab/new-order',{title:'New Laboratory Order',patient,tests,packages,today:new Date().toISOString().slice(0,10)});
}catch(err){next(err);}}

async function createOrder(req,res,next){try{
  const testIds=Array.isArray(req.body.testIds)?req.body.testIds:(req.body.testIds?[req.body.testIds]:[]);
  const result=await labService.createOrder(Number(req.body.patientId),branchId(req),req.user.id,{testIds,packageIds:req.body.packageIds,source:req.body.source||'RECEPTION',bookingDate:req.body.bookingDate,priority:req.body.priority,clinicalNotes:req.body.clinicalNotes,collectionType:req.body.collectionType,homeCollectionAddress:req.body.homeCollectionAddress,homeCollectionScheduledAt:req.body.homeCollectionScheduledAt,discountAmount:req.user.permissions.includes('lab.accounting.manage')?req.body.discountAmount:0,discountReason:req.user.permissions.includes('lab.accounting.manage')?req.body.discountReason:''});
  req.flash('success','Laboratory order '+result.orderCode+' created.');
  res.redirect('/lab/orders/'+result.id);
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/orders/new');}next(err);}}

async function orderDetail(req,res,next){try{
  const data=await labService.getOrder(req.params.id); if(!data)throw new AppError('Laboratory order not found',404); if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.order.branch_id)!==Number(req.user.branch_id))throw new AppError('You do not have access to this laboratory branch',403);
  const payments=await labSmartService.getOrderPayments(branchId(req),data.order.id);
  const tpaClaim=await labSmartService.getTpaClaim(branchId(req),data.order.id);
  const phlebotomists=data.order.collection_type==='HOME'?await labSmartService.listPhlebotomists(branchId(req)):[];
  const paid=payments.reduce((sum,p)=>sum+Number(p.amount||0),0);
  const shareUrl=req.protocol+'://'+req.get('host')+'/lab/orders/'+data.order.id+'/share';
  res.render('lab/order-detail',{title:data.order.order_code+' · Laboratory Order',...data,payments,tpaClaim,phlebotomists,paid,due:Math.max(0,Number(data.order.net_amount||0)-paid),shareUrl});
}catch(err){next(err);}}

async function collectSample(req,res,next){try{
  const r=await labService.collectSample(req.params.itemId,req.user.id,req.body);
  req.flash('success','Sample collected. Barcode '+r.barcode+'.');res.redirect(req.get('Referer')||'/lab/orders');
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.get('Referer')||'/lab/orders');}next(err);}}

async function receiveSample(req,res,next){try{await labService.receiveSample(req.params.itemId,req.user.id);req.flash('success','Sample received by laboratory.');res.redirect(req.get('Referer')||'/lab/orders');}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.get('Referer')||'/lab/orders');}next(err);}}

async function rejectSample(req,res,next){try{await labService.rejectSample(req.params.itemId,req.user.id,req.body.reason);req.flash('success','Sample marked rejected.');res.redirect(req.get('Referer')||'/lab/orders');}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.get('Referer')||'/lab/orders');}next(err);}}

async function resultForm(req,res,next){try{
  const data=await labService.getOrder(req.params.orderId); if(!data)throw new AppError('Laboratory order not found',404);
  if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.order.branch_id)!==Number(branchId(req)))throw new AppError('You do not have access to this laboratory branch',403);
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
async function releaseResult(req,res,next){try{
  await labService.releaseResult(req.params.id,req.user.id);
  let notice='Report released to the patient portal.';
  try{
    const data=await labService.getResult(req.params.id);
    if(data&&data.result.email){
      const token=await labSmartService.createShareToken(branchId(req),req.user.id,data.result.lab_order_id,data.result.id);
      const url=(process.env.PUBLIC_BASE_URL||req.protocol+'://'+req.get('host')).replace(/\/$/,'')+'/lab/share/'+token;
      const safe=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      const sent=await emailService.sendMail({to:data.result.email,subject:'Chhayabithi Laboratory Report — '+data.result.order_code,html:'<p>Dear '+safe(data.result.patient_name)+',</p><p>Your laboratory report for <strong>'+safe(data.result.test_name_snapshot)+'</strong> is ready.</p><p><a href="'+safe(url)+'">View secure report</a></p><p>This link expires in 7 days.</p>',text:'Your Chhayabithi laboratory report is ready. View securely: '+url+' (link expires in 7 days).'});
      await labSmartService.logNotification({orderId:data.result.lab_order_id,resultId:data.result.id,channel:'EMAIL',recipient:data.result.email,status:sent.sent?'SENT':'FAILED',message:'Automatic report-ready email',errorMessage:sent.sent?null:sent.reason,userId:req.user.id});
      if(sent.sent)notice+=' A secure report link was emailed to the patient.';
    }
  }catch(notificationError){console.warn('[lab] Report released, but automatic notification failed:',notificationError.message);}
  req.flash('success',notice);
  res.redirect('/lab/results/'+req.params.id);
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/results/'+req.params.id);}next(err);}}

async function attachFile(req,res,next){try{
  await labService.attachReportFile(req.params.id,req.user.id,req.file);req.flash('success','Digital report file attached.');res.redirect('/lab/results/'+req.params.id);
}catch(err){if(req.file){try{fs.unlinkSync(req.file.path);}catch(_){}}if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/results/'+req.params.id);}next(err);}}

async function printReport(req,res,next){try{
  const data=await labService.getResult(req.params.id);if(!data)throw new AppError('Report not found',404);if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.result.branch_id)!==Number(req.user.branch_id))throw new AppError('You do not have access to this laboratory branch',403);
  if(data.result.status!=='RELEASED'&&!req.user.permissions.includes('lab.result.release'))throw new AppError('Report has not been released',403);
  const settings=await labSmartService.getSettings(branchId(req));
  let qrDataUri=null,barcodeDataUri=null,shareUrl=null;
  const barcode=await bwipjs.toBuffer({bcid:'code128',text:data.result.order_code,scale:2,height:12,includetext:true});
  barcodeDataUri='data:image/png;base64,'+barcode.toString('base64');
  if(data.result.status==='RELEASED'){
    const token=await labSmartService.createShareToken(branchId(req),req.user.id,data.result.lab_order_id,data.result.id);
    shareUrl=(process.env.PUBLIC_BASE_URL||req.protocol+'://'+req.get('host')).replace(/\/$/,'')+'/lab/share/'+token;
    const png=await bwipjs.toBuffer({bcid:'qrcode',text:shareUrl,scale:4,padding:1});
    qrDataUri='data:image/png;base64,'+png.toString('base64');
  }
  res.render('print/lab-report',{layout:'layouts/blank',title:'Laboratory Report',...data,settings,qrDataUri,barcodeDataUri,shareUrl});
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


async function packages(req,res,next){try{
  const rows=await labSmartService.listPackages(branchId(req),true);
  res.render('lab/packages',{title:'Laboratory Packages & Panels',packages:rows});
}catch(err){next(err);}}

async function packageForm(req,res,next){try{
  const id=req.params.id?Number(req.params.id):null;
  const item=id?await labSmartService.getPackage(id,branchId(req)):null;
  if(id&&!item)throw new AppError('Package not found',404);
  const tests=await labService.getAvailableTestsForBranch(branchId(req));
  res.render('lab/package-form',{title:item?'Edit Test Package':'New Test Package',item,tests});
}catch(err){next(err);}}

async function savePackage(req,res,next){try{
  const id=await labSmartService.savePackage(branchId(req),req.user.id,req.body,req.params.id?Number(req.params.id):null);
  req.flash('success','Laboratory package saved.');
  res.redirect('/lab/packages/'+id+'/edit');
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect(req.params.id?'/lab/packages/'+req.params.id+'/edit':'/lab/packages/new');}next(err);}}

async function accounting(req,res,next){try{
  const today=new Date().toISOString().slice(0,10);
  const fromDate=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||''))?req.query.from:today.slice(0,8)+'01';
  const toDate=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||''))?req.query.to:today;
  if(fromDate>toDate)throw new AppError('Start date must be on or before end date.',422);
  const data=await labSmartService.getAccounting(branchId(req),fromDate,toDate);
  res.render('lab/accounting',{title:'Laboratory Business Analytics',...data,fromDate,toDate,net:Number(data.summary.collected)-Number(data.summary.expenses)});
}catch(err){next(err);}}

async function createExpense(req,res,next){try{
  await labSmartService.createExpense(branchId(req),req.user.id,req.body);
  req.flash('success','Laboratory expense recorded.');
  res.redirect('/lab/accounting?from='+encodeURIComponent(req.body.expenseDate)+'&to='+encodeURIComponent(req.body.expenseDate));
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/accounting');}next(err);}}

async function recordPayment(req,res,next){try{
  const result=await labSmartService.recordPayment(branchId(req),req.user.id,Number(req.params.id),req.body);
  req.flash('success','Payment recorded. Outstanding balance: ₹'+result.due.toFixed(2)+'.');
  res.redirect('/lab/orders/'+req.params.id);
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/orders/'+req.params.id);}next(err);}}

async function exportCsv(req,res,next){try{
  const today=new Date().toISOString().slice(0,10);
  const fromDate=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||''))?req.query.from:today.slice(0,8)+'01';
  const toDate=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||''))?req.query.to:today;
  if(fromDate>toDate)throw new AppError('Start date must be on or before end date.',422);
  const rows=await labSmartService.exportRows(branchId(req),fromDate,toDate);
  const headers=['Order code','Booking date','Health ID','Patient','Gender','Age','Source','Priority','Order status','Test code','Test','Test status','Test price','Order net amount','Payment status','Paid amount','Due amount','Created at','Reported at'];
  const keys=['order_code','booking_date','health_id','patient_name','gender','age_years','source','priority','status','test_code_snapshot','test_name_snapshot','test_status','price_snapshot','net_amount','payment_status','paid_amount','due_amount','created_at','completed_at'];
  const csv=[headers, ...rows.map(row=>keys.map(key=>row[key]))].map(row=>row.map(labSmartService.csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="chhayabithi-lab-export-'+fromDate+'-to-'+toDate+'.csv"');
  res.send('\uFEFF'+csv);
}catch(err){next(err);}}

async function printSampleLabel(req,res,next){try{
  const [[sample]]=await pool.execute('SELECT oi.id item_id,oi.test_name_snapshot,oi.test_code_snapshot,o.order_code,p.name patient_name,p.health_id,l.name laboratory_name,s.sample_code,s.barcode_value,s.specimen_type,s.container_type,s.volume,s.collected_at,s.received_at,s.status sample_status FROM lab_samples s JOIN lab_order_items oi ON oi.id=s.lab_order_item_id JOIN lab_orders o ON o.id=oi.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id JOIN patients p ON p.id=o.patient_id WHERE oi.id=:itemId AND l.branch_id=:branchId ORDER BY s.id DESC LIMIT 1',{itemId:req.params.itemId,branchId:branchId(req)});
  if(!sample)throw new AppError('Sample barcode not found for this test.',404);
  const barcode=await bwipjs.toBuffer({bcid:'code128',text:sample.barcode_value,scale:2,height:14,includetext:true});
  res.render('print/lab-sample-label',{layout:'layouts/blank',title:'Sample Barcode Label',sample,barcodeDataUri:'data:image/png;base64,'+barcode.toString('base64')});
}catch(err){next(err);}}

async function printBill(req,res,next){try{
  const data=await labService.getOrder(req.params.id);if(!data)throw new AppError('Laboratory order not found',404);
  if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.order.branch_id)!==Number(branchId(req)))throw new AppError('You do not have access to this laboratory branch',403);
  const token=await labSmartService.createShareToken(branchId(req),req.user.id,data.order.id);
  const shareUrl=(process.env.PUBLIC_BASE_URL||req.protocol+'://'+req.get('host')).replace(/\/$/,'')+'/lab/share/'+token;
  const png=await bwipjs.toBuffer({bcid:'qrcode',text:shareUrl,scale:4,padding:1});
  const barcode=await bwipjs.toBuffer({bcid:'code128',text:data.order.order_code,scale:2,height:12,includetext:true});
  const payments=await labSmartService.getOrderPayments(branchId(req),data.order.id);
  const paid=payments.reduce((sum,p)=>sum+Number(p.amount||0),0);
  const settings=await labSmartService.getSettings(branchId(req));
  res.render('print/lab-bill',{layout:'layouts/blank',title:'Laboratory Bill',...data,settings,paid,due:Math.max(0,Number(data.order.net_amount||0)-paid),qrDataUri:'data:image/png;base64,'+png.toString('base64'),barcodeDataUri:'data:image/png;base64,'+barcode.toString('base64'),shareUrl});
}catch(err){next(err);}}

async function shareOrder(req,res,next){try{
  const data=await labService.getOrder(req.params.id);if(!data)throw new AppError('Laboratory order not found',404);
  if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.order.branch_id)!==Number(branchId(req)))throw new AppError('You do not have access to this laboratory branch',403);
  const token=await labSmartService.createShareToken(branchId(req),req.user.id,data.order.id);
  const url=(process.env.PUBLIC_BASE_URL||req.protocol+'://'+req.get('host')).replace(/\/$/,'')+'/lab/share/'+token;
  const png=await bwipjs.toBuffer({bcid:'qrcode',text:url,scale:5,padding:2});
  res.render('lab/share',{title:'Share Lab Bill & Report Status',order:data.order,token,url,qrDataUri:'data:image/png;base64,'+png.toString('base64'),phone:data.order.mobile||'',kind:'order'});
}catch(err){next(err);}}

async function shareResult(req,res,next){try{
  const data=await labService.getResult(req.params.id);if(!data)throw new AppError('Report not found',404);
  if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.result.branch_id)!==Number(branchId(req)))throw new AppError('You do not have access to this laboratory branch',403);
  if(data.result.status!=='RELEASED')throw new AppError('Only a released report can be shared.',409);
  const token=await labSmartService.createShareToken(branchId(req),req.user.id,data.result.lab_order_id,data.result.id);
  const url=(process.env.PUBLIC_BASE_URL||req.protocol+'://'+req.get('host')).replace(/\/$/,'')+'/lab/share/'+token;
  const png=await bwipjs.toBuffer({bcid:'qrcode',text:url,scale:5,padding:2});
  const [[patient]]=await pool.execute('SELECT mobile,email FROM patients WHERE id=:id',{id:data.result.patient_id});
  res.render('lab/share',{title:'Share Laboratory Report',order:{id:data.result.lab_order_id,order_code:data.result.order_code,patient_name:data.result.patient_name},result:data.result,token,url,qrDataUri:'data:image/png;base64,'+png.toString('base64'),phone:patient?.mobile||'',email:patient?.email||'',kind:'result'});
}catch(err){next(err);}}

async function emailReport(req,res,next){try{
  const data=await labService.getResult(req.params.id);if(!data)throw new AppError('Report not found',404);
  if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.result.branch_id)!==Number(branchId(req)))throw new AppError('You do not have access to this laboratory branch',403);
  if(data.result.status!=='RELEASED')throw new AppError('Only a released report can be shared.',409);
  const to=String(req.body.email||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new AppError('Enter a valid email address.',422);
  const token=await labSmartService.createShareToken(branchId(req),req.user.id,data.result.lab_order_id,data.result.id);
  const url=(process.env.PUBLIC_BASE_URL||req.protocol+'://'+req.get('host')).replace(/\/$/,'')+'/lab/share/'+token;
  const safe=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const result=await emailService.sendMail({to,subject:'Chhayabithi Laboratory Report — '+data.result.order_code,html:'<p>Dear '+safe(data.result.patient_name)+',</p><p>Your laboratory report is ready.</p><p><strong>Test:</strong> '+safe(data.result.test_name_snapshot)+'</p><p><a href="'+safe(url)+'">View secure report</a></p><p>This link expires in 7 days. Please do not forward it to unauthorized people.</p>',text:'Your Chhayabithi laboratory report is ready. View securely: '+url+' (link expires in 7 days).'});
  await labSmartService.logNotification({orderId:data.result.lab_order_id,resultId:data.result.id,channel:'EMAIL',recipient:to,status:result.sent?'SENT':'FAILED',message:'Secure report link email',errorMessage:result.sent?null:result.reason,userId:req.user.id});
  if(!result.sent)throw new AppError('Email was not sent ('+result.reason+'). Check SMTP configuration and logs.',502);
  req.flash('success','Secure report link emailed to '+to+'.');
  res.redirect('/lab/results/'+req.params.id+'/share');
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/results/'+req.params.id+'/share');}next(err);}}



async function staff(req,res,next){try{
  const data=await labSmartService.listLabStaff(branchId(req));
  res.render('lab/staff',{title:'Laboratory Staff & Permissions',...data});
}catch(err){next(err);}}

async function saveStaff(req,res,next){try{
  await labSmartService.saveLabWorker(branchId(req),req.user.id,req.body);
  req.flash('success','Laboratory staff assignment saved.');
  res.redirect('/lab/workers');
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/workers');}next(err);}}

async function settings(req,res,next){try{
  const data=await labSmartService.getSettings(branchId(req));
  res.render('lab/settings',{title:'Laboratory Settings & Review Builder',settings:data});
}catch(err){next(err);}}

async function saveSettings(req,res,next){try{
  await labSmartService.saveSettings(branchId(req),req.user.id,req.body);
  req.flash('success','Laboratory settings saved.');
  res.redirect('/lab/settings');
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/settings');}next(err);}}

async function reviewBuilder(req,res,next){try{
  const settings=await labSmartService.getSettings(branchId(req));
  let order=null;
  if(req.query.orderId){
    const data=await labService.getOrder(req.query.orderId);
    if(!data)throw new AppError('Laboratory order not found',404);
    if(!req.user.roles.includes('SUPER_ADMIN')&&Number(data.order.branch_id)!==Number(branchId(req)))throw new AppError('You do not have access to this laboratory branch',403);
    order=data.order;
  }
  const message=String(settings.review_message||'Thank you for choosing Chhayabithi Hospital. If you are satisfied with our service, please share your feedback.')
    .replace(/\{patient\}/gi,order?.patient_name||'')
    .replace(/\{order\}/gi,order?.order_code||'');
  res.render('lab/review-builder',{title:'Google Review Builder',settings,order,message,reviewUrl:settings.google_review_url||''});
}catch(err){next(err);}}

async function assignHomeCollection(req,res,next){try{
  const result=await labSmartService.assignHomeCollection(branchId(req),req.user.id,Number(req.params.id),req.body.assignedTo);
  req.flash('success',result.status==='ASSIGNED'?'Home collection assigned to phlebotomist.':'Home collection assignment cleared.');
  res.redirect('/lab/orders/'+req.params.id);
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/orders/'+req.params.id);}next(err);}}

async function saveTpaClaim(req,res,next){try{
  await labSmartService.saveTpaClaim(branchId(req),req.user.id,Number(req.params.id),req.body);
  req.flash('success','Insurance / TPA claim saved.');
  res.redirect('/lab/orders/'+req.params.id);
}catch(err){if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/lab/orders/'+req.params.id);}next(err);}}

module.exports={dashboard,orders,showNewOrder,createOrder,orderDetail,printBill,printSampleLabel,collectSample,receiveSample,rejectSample,resultForm,saveResult,viewResult,verifyResult,releaseResult,attachFile,printReport,downloadReportFile,tests,showTestForm,saveTest,cancelOrder,packages,packageForm,savePackage,accounting,createExpense,recordPayment,exportCsv,shareOrder,shareResult,emailReport,settings,saveSettings,reviewBuilder,saveTpaClaim,assignHomeCollection,staff,saveStaff};
