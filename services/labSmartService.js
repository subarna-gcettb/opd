const crypto = require('crypto');
const { pool, withTransaction } = require('../config/database');
const labService = require('./labService');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

async function getLaboratory(branchId, conn = pool) {
  const [[lab]] = await conn.execute(
    'SELECT id, branch_id, name FROM laboratories WHERE branch_id=:branchId AND is_active=1 AND deleted_at IS NULL ORDER BY id LIMIT 1',
    { branchId }
  );
  if (!lab) throw new AppError('No active laboratory is configured for this branch.', 409);
  return lab;
}

async function listPackages(branchId, includeInactive = false) {
  const params = { branchId };
  const where = ['l.branch_id=:branchId', 'l.is_active=1', 'p.deleted_at IS NULL'];
  if (!includeInactive) where.push('p.is_active=1');
  const [packages] = await pool.execute(
    'SELECT p.*, COUNT(pi.id) test_count FROM lab_test_packages p JOIN laboratories l ON l.id=p.laboratory_id LEFT JOIN lab_test_package_items pi ON pi.package_id=p.id WHERE ' + where.join(' AND ') + ' GROUP BY p.id ORDER BY p.name',
    params
  );
  for (const item of packages) {
    const [tests] = await pool.execute(
      'SELECT t.id,t.code,t.name,t.test_type,t.price FROM lab_test_package_items pi JOIN lab_tests t ON t.id=pi.test_id WHERE pi.package_id=:id AND t.deleted_at IS NULL ORDER BY t.name',
      { id: item.id }
    );
    item.tests = tests;
  }
  return packages;
}

async function getPackage(id, branchId) {
  const [[item]] = await pool.execute(
    'SELECT p.* FROM lab_test_packages p JOIN laboratories l ON l.id=p.laboratory_id WHERE p.id=:id AND l.branch_id=:branchId AND p.deleted_at IS NULL',
    { id, branchId }
  );
  if (!item) return null;
  const [tests] = await pool.execute(
    'SELECT t.id,t.code,t.name,t.price,t.test_type FROM lab_test_package_items pi JOIN lab_tests t ON t.id=pi.test_id WHERE pi.package_id=:id ORDER BY t.name',
    { id }
  );
  return { ...item, tests };
}

async function savePackage(branchId, actorUserId, payload, id = null) {
  return withTransaction(async conn => {
    const lab = await getLaboratory(branchId, conn);
    const code = String(payload.code || '').trim().toUpperCase();
    const name = String(payload.name || '').trim();
    const price = Number(payload.price);
    const ids = [...new Set((Array.isArray(payload.testIds) ? payload.testIds : payload.testIds ? [payload.testIds] : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!code || !name) throw new AppError('Package code and name are required.', 422);
    if (!Number.isFinite(price) || price < 0) throw new AppError('Package price must be a non-negative amount.', 422);
    if (!ids.length) throw new AppError('Select at least one test for this package.', 422);
    const placeholders = ids.map((_, i) => ':t' + i).join(',');
    const params = { labId: lab.id }; ids.forEach((testId, i) => { params['t' + i] = testId; });
    const [tests] = await conn.execute(
      'SELECT id FROM lab_tests WHERE laboratory_id=:labId AND is_active=1 AND deleted_at IS NULL AND id IN (' + placeholders + ')',
      params
    );
    if (tests.length !== ids.length) throw new AppError('One or more selected tests are unavailable at this laboratory.', 422);
    let packageId = id;
    if (id) {
      const [[existing]] = await conn.execute('SELECT id FROM lab_test_packages WHERE id=:id AND laboratory_id=:labId AND deleted_at IS NULL FOR UPDATE', { id, labId: lab.id });
      if (!existing) throw new AppError('Package not found.', 404);
      await conn.execute('UPDATE lab_test_packages SET code=:code,name=:name,description=:description,price=:price,is_active=:active WHERE id=:id',
        { id, code, name, description: String(payload.description || '').trim() || null, price, active: payload.isActive === '0' ? 0 : 1 });
      await conn.execute('DELETE FROM lab_test_package_items WHERE package_id=:id', { id });
    } else {
      const [r] = await conn.execute(
        'INSERT INTO lab_test_packages (laboratory_id,code,name,description,price,is_active,created_by) VALUES (:labId,:code,:name,:description,:price,1,:userId)',
        { labId: lab.id, code, name, description: String(payload.description || '').trim() || null, price, userId: actorUserId }
      );
      packageId = r.insertId;
    }
    for (const testId of ids) await conn.execute('INSERT INTO lab_test_package_items (package_id,test_id) VALUES (:packageId,:testId)', { packageId, testId });
    await auditService.log({userId:actorUserId,action:id?'LAB_PACKAGE_UPDATED':'LAB_PACKAGE_CREATED',entity:'lab_test_package',entityId:packageId,newValue:{code,name,price,testIds:ids}},conn);
    return packageId;
  });
}

async function recordPayment(branchId, actorUserId, orderId, payload) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Enter a payment amount greater than zero.', 422);
  const methods = ['CASH','UPI','CARD','BANK_TRANSFER','CHEQUE','OTHER'];
  const method = methods.includes(payload.paymentMethod) ? payload.paymentMethod : 'CASH';
  return withTransaction(async conn => {
    const [[order]] = await conn.execute(
      'SELECT o.id,o.net_amount,o.payment_status,l.branch_id FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id WHERE o.id=:id AND l.branch_id=:branchId FOR UPDATE',
      { id: orderId, branchId }
    );
    if (!order) throw new AppError('Laboratory order not found in this branch.', 404);
    if (order.payment_status === 'WAIVED') throw new AppError('This order has been waived and cannot accept a payment.', 409);
    const [[paidRow]] = await conn.execute('SELECT COALESCE(SUM(amount),0) paid FROM lab_order_payments WHERE lab_order_id=:id', { id: orderId });
    const paid = Number(paidRow.paid || 0);
    const due = Math.max(0, Number(order.net_amount || 0) - paid);
    if (amount > due + 0.005) throw new AppError('Payment exceeds the outstanding balance of ₹' + due.toFixed(2) + '.', 422);
    await conn.execute(
      'INSERT INTO lab_order_payments (lab_order_id,amount,payment_method,reference_no,notes,received_by) VALUES (:id,:amount,:method,:reference,:notes,:userId)',
      { id: orderId, amount, method, reference: String(payload.referenceNo || '').trim() || null, notes: String(payload.notes || '').trim() || null, userId: actorUserId }
    );
    const newPaid = paid + amount;
    const status = newPaid + 0.005 >= Number(order.net_amount || 0) ? 'PAID' : 'PARTIAL';
    await conn.execute('UPDATE lab_orders SET payment_status=:status WHERE id=:id', { status, id: orderId });
    await auditService.log({userId:actorUserId,action:'LAB_PAYMENT_RECORDED',entity:'lab_order',entityId:orderId,newValue:{amount,method,referenceNo:payload.referenceNo||null,paid:newPaid,due:Math.max(0,Number(order.net_amount||0)-newPaid)}},conn);
    return { paid: newPaid, due: Math.max(0, Number(order.net_amount || 0) - newPaid), status };
  });
}

async function getOrderPayments(branchId, orderId) {
  const [rows] = await pool.execute(
    'SELECT py.*,u.name received_by_name FROM lab_order_payments py JOIN lab_orders o ON o.id=py.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id JOIN users u ON u.id=py.received_by WHERE py.lab_order_id=:orderId AND l.branch_id=:branchId ORDER BY py.received_at DESC',
    { orderId, branchId }
  );
  return rows;
}

async function getAccounting(branchId, fromDate, toDate) {
  const [collections] = await pool.execute(
    'SELECT DATE(py.received_at) day, py.payment_method, COUNT(*) transactions, SUM(py.amount) amount FROM lab_order_payments py JOIN lab_orders o ON o.id=py.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id WHERE l.branch_id=:branchId AND DATE(py.received_at) BETWEEN :fromDate AND :toDate GROUP BY DATE(py.received_at),py.payment_method ORDER BY day DESC',
    { branchId, fromDate, toDate }
  );
  const [expenses] = await pool.execute(
    'SELECT e.*,u.name created_by_name FROM lab_expenses e JOIN users u ON u.id=e.created_by WHERE e.branch_id=:branchId AND e.expense_date BETWEEN :fromDate AND :toDate ORDER BY e.expense_date DESC,e.id DESC LIMIT 500',
    { branchId, fromDate, toDate }
  );
  const [[summary]] = await pool.execute(
    'SELECT (SELECT COALESCE(SUM(py.amount),0) FROM lab_order_payments py JOIN lab_orders o ON o.id=py.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id WHERE l.branch_id=:branchId AND DATE(py.received_at) BETWEEN :fromDate AND :toDate) collected, (SELECT COALESCE(SUM(e.amount),0) FROM lab_expenses e WHERE e.branch_id=:branchId AND e.expense_date BETWEEN :fromDate AND :toDate) expenses, (SELECT COUNT(*) FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id WHERE l.branch_id=:branchId AND o.booking_date BETWEEN :fromDate AND :toDate AND o.status<>\'CANCELLED\') orders_count, (SELECT COUNT(*) FROM lab_order_items oi JOIN lab_orders o ON o.id=oi.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id WHERE l.branch_id=:branchId AND oi.status=\'REPORTED\' AND DATE(oi.completed_at) BETWEEN :fromDate AND :toDate) reports_count',
    { branchId, fromDate, toDate }
  );
  const [topTests] = await pool.execute(
    'SELECT oi.test_code_snapshot code,oi.test_name_snapshot name,COUNT(*) count FROM lab_order_items oi JOIN lab_orders o ON o.id=oi.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id WHERE l.branch_id=:branchId AND o.booking_date BETWEEN :fromDate AND :toDate AND oi.status<>\'CANCELLED\' GROUP BY oi.test_code_snapshot,oi.test_name_snapshot ORDER BY count DESC LIMIT 10',
    { branchId, fromDate, toDate }
  );
  const [tat] = await pool.execute(
    'SELECT oi.test_name_snapshot name,AVG(TIMESTAMPDIFF(MINUTE,s.collected_at,oi.completed_at)) avg_minutes,COUNT(*) count FROM lab_order_items oi JOIN lab_orders o ON o.id=oi.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id JOIN (SELECT lab_order_item_id,MAX(collected_at) collected_at FROM lab_samples GROUP BY lab_order_item_id) s ON s.lab_order_item_id=oi.id WHERE l.branch_id=:branchId AND oi.completed_at IS NOT NULL AND s.collected_at IS NOT NULL AND DATE(oi.completed_at) BETWEEN :fromDate AND :toDate GROUP BY oi.test_name_snapshot ORDER BY avg_minutes DESC LIMIT 10',
    { branchId, fromDate, toDate }
  );
  return { collections, expenses, summary: { collected: Number(summary.collected || 0), expenses: Number(summary.expenses || 0), orders: Number(summary.orders_count || 0), reports: Number(summary.reports_count || 0) }, topTests, tat };
}

async function createExpense(branchId, actorUserId, payload) {
  const category = String(payload.category || '').trim();
  const description = String(payload.description || '').trim();
  const amount = Number(payload.amount);
  const date = String(payload.expenseDate || '').trim();
  if (!category || !description || !date) throw new AppError('Category, description and expense date are required.', 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Expense date must be valid.', 422);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Expense amount must be greater than zero.', 422);
  const methods = ['CASH','UPI','CARD','BANK_TRANSFER','CHEQUE','OTHER'];
  const method = methods.includes(payload.paymentMethod) ? payload.paymentMethod : 'CASH';
  const lab = await getLaboratory(branchId);
  const [r] = await pool.execute(
    'INSERT INTO lab_expenses (branch_id,laboratory_id,category,description,amount,expense_date,payment_method,reference_no,created_by) VALUES (:branchId,:labId,:category,:description,:amount,:date,:method,:reference,:userId)',
    { branchId, labId: lab.id, category, description, amount, date, method, reference: String(payload.referenceNo || '').trim() || null, userId: actorUserId }
  );
  await auditService.log({userId:actorUserId,action:'LAB_EXPENSE_RECORDED',entity:'lab_expense',entityId:r.insertId,newValue:{category,amount,date,paymentMethod:method}});
  return r.insertId;
}

async function createShareToken(branchId, actorUserId, orderId, resultId = null) {
  const [[order]] = await pool.execute(
    'SELECT o.id,l.branch_id FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id WHERE o.id=:id AND l.branch_id=:branchId',
    { id: orderId, branchId }
  );
  if (!order) throw new AppError('Laboratory order not found in this branch.', 404);
  if (resultId) {
    const [[result]] = await pool.execute(
      'SELECT r.id,r.status,oi.lab_order_id FROM lab_results r JOIN lab_order_items oi ON oi.id=r.lab_order_item_id WHERE r.id=:resultId AND oi.lab_order_id=:orderId AND r.is_current=1',
      { resultId, orderId }
    );
    if (!result || result.status !== 'RELEASED') throw new AppError('Only the current released report can be shared.', 409);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.execute(
    'INSERT INTO lab_share_tokens (token_hash,lab_order_id,lab_result_id,expires_at,created_by) VALUES (:hash,:orderId,:resultId,DATE_ADD(NOW(),INTERVAL 7 DAY),:userId)',
    { hash: tokenHash, orderId, resultId, userId: actorUserId }
  );
  await auditService.log({userId:actorUserId,action:'LAB_SHARE_TOKEN_CREATED',entity:resultId?'lab_result':'lab_order',entityId:resultId||orderId,newValue:{expiresInDays:7}});
  return token;
}

async function getPublicOrder(token) {
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const [[order]] = await pool.execute(
    'SELECT o.id,o.order_code,o.booking_date,o.status,o.total_amount,o.discount_amount,o.net_amount,o.payment_status,o.created_at,p.name patient_name,p.health_id,l.name laboratory_name,l.phone laboratory_phone,st.expires_at,st.lab_result_id token_result_id FROM lab_share_tokens st JOIN lab_orders o ON o.id=st.lab_order_id JOIN patients p ON p.id=o.patient_id JOIN laboratories l ON l.id=o.laboratory_id WHERE st.token_hash=:hash AND st.revoked_at IS NULL AND st.expires_at>NOW() LIMIT 1',
    { hash }
  );
  if (!order) return null;
  const [items] = await pool.execute(
    'SELECT oi.id,oi.test_name_snapshot,oi.test_code_snapshot,oi.status,oi.completed_at,r.id result_id,r.status result_status,r.version result_version,r.report_file_name FROM lab_order_items oi LEFT JOIN lab_results r ON r.lab_order_item_id=oi.id AND r.is_current=1 WHERE oi.lab_order_id=:id ORDER BY oi.id',
    { id: order.id }
  );
  if (order.token_result_id) {
    for (const item of items) if (Number(item.result_id) !== Number(order.token_result_id)) { item.result_id = null; item.result_status = null; item.result_version = null; item.report_file_name = null; }
  }
  return { order, items };
}

async function getPublicReport(token, resultId) {
  const publicOrder = await getPublicOrder(token);
  if (!publicOrder) return null;
  if (publicOrder.order.token_result_id && Number(publicOrder.order.token_result_id) !== Number(resultId)) return null;
  const item = publicOrder.items.find(row => Number(row.result_id) === Number(resultId) && row.result_status === 'RELEASED');
  if (!item) return null;
  return labService.getResult(resultId);
}

async function logNotification({ orderId, resultId = null, channel, recipient, status = 'PREPARED', message = null, errorMessage = null, userId = null }) {
  await pool.execute(
    'INSERT INTO lab_notification_logs (lab_order_id,lab_result_id,channel,recipient,status,message,error_message,created_by,sent_at) VALUES (:orderId,:resultId,:channel,:recipient,:status,:message,:errorMessage,:userId,IF(:status=\'SENT\',NOW(),NULL))',
    { orderId, resultId, channel, recipient, status, message, errorMessage, userId }
  );
}

function csvCell(value) {
  let text = String(value === null || value === undefined ? '' : value);
  // Avoid spreadsheet formula injection for exported data.
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}




async function listLabStaff(branchId) {
  const lab=await getLaboratory(branchId);
  const [users]=await pool.execute('SELECT id,name,email,mobile FROM users WHERE branch_id=:branchId AND is_active=1 ORDER BY name',{branchId});
  const [workers]=await pool.execute('SELECT w.*,u.name,u.email,u.mobile FROM lab_workers w JOIN users u ON u.id=w.user_id WHERE w.laboratory_id=:labId AND w.deleted_at IS NULL ORDER BY u.name',{labId:lab.id});
  return {lab,users,workers};
}

async function saveLabWorker(branchId, actorUserId, payload) {
  const lab=await getLaboratory(branchId);
  const userId=Number(payload.userId);
  const types=['RECEPTION','TECHNICIAN','PATHOLOGIST','RADIOLOGIST','CARDIOLOGY','ADMIN','QUALITY','PHLEBOTOMIST'];
  const workerType=types.includes(payload.workerType)?payload.workerType:'TECHNICIAN';
  if(!Number.isInteger(userId)||userId<=0)throw new AppError('Select a valid staff user.',422);
  const [[user]]=await pool.execute('SELECT id FROM users WHERE id=:userId AND branch_id=:branchId AND is_active=1 LIMIT 1',{userId,branchId});
  if(!user)throw new AppError('Select an active user assigned to this branch.',422);
  const registration=String(payload.registrationNo||'').trim()||null;
  const active=payload.isActive==='0'?0:1;
  await pool.execute('INSERT INTO lab_workers (user_id,laboratory_id,worker_type,professional_registration_no,is_active,deleted_at) VALUES (:userId,:labId,:workerType,:registration,:active,NULL) ON DUPLICATE KEY UPDATE worker_type=VALUES(worker_type),professional_registration_no=VALUES(professional_registration_no),is_active=VALUES(is_active),deleted_at=NULL',
    {userId,labId:lab.id,workerType,registration,active});
  await auditService.log({userId:actorUserId,action:'LAB_WORKER_CONFIGURED',entity:'lab_worker',entityId:userId,newValue:{workerType,active,registration}});
}

async function listPhlebotomists(branchId) {
  const [rows]=await pool.execute('SELECT u.id,u.name,u.mobile,w.professional_registration_no FROM lab_workers w JOIN laboratories l ON l.id=w.laboratory_id JOIN users u ON u.id=w.user_id WHERE l.branch_id=:branchId AND l.is_active=1 AND w.worker_type=\'PHLEBOTOMIST\' AND w.is_active=1 AND w.deleted_at IS NULL AND u.is_active=1 ORDER BY u.name',{branchId});
  return rows;
}

async function assignHomeCollection(branchId, actorUserId, orderId, assigneeId) {
  return withTransaction(async conn=>{
    const [[order]]=await conn.execute('SELECT o.id,o.collection_type FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id WHERE o.id=:orderId AND l.branch_id=:branchId FOR UPDATE',{orderId,branchId});
    if(!order)throw new AppError('Laboratory order not found in this branch.',404);
    if(order.collection_type!=='HOME')throw new AppError('This order is not scheduled for home collection.',409);
    const assignedTo=String(assigneeId||'').trim()?Number(assigneeId):null;
    if(assignedTo!==null){
      if(!Number.isInteger(assignedTo)||assignedTo<=0)throw new AppError('Select a valid phlebotomist.',422);
      const [[worker]]=await conn.execute('SELECT w.id FROM lab_workers w JOIN laboratories l ON l.id=w.laboratory_id JOIN users u ON u.id=w.user_id WHERE l.branch_id=:branchId AND u.id=:userId AND w.worker_type=\'PHLEBOTOMIST\' AND w.is_active=1 AND w.deleted_at IS NULL AND u.is_active=1 LIMIT 1',{branchId,userId:assignedTo});
      if(!worker)throw new AppError('The selected user is not an active phlebotomist for this branch.',422);
    }
    const status=assignedTo===null?'REQUESTED':'ASSIGNED';
    await conn.execute('UPDATE lab_orders SET home_collection_assigned_to=:assignedTo,home_collection_status=:status WHERE id=:orderId',{assignedTo,status,orderId});
    await auditService.log({userId:actorUserId,action:'LAB_HOME_COLLECTION_ASSIGNMENT_UPDATED',entity:'lab_order',entityId:orderId,newValue:{assignedTo,status}},conn);
    return {assignedTo,status};
  });
}

const DEFAULT_SETTINGS = {
  google_review_url: '',
  review_message: 'Thank you for choosing Chhayabithi Hospital. If you are satisfied with our service, please share your feedback.',
  report_font_size_pt: 10,
  report_margin_top_mm: 10,
  report_margin_bottom_mm: 10,
  report_show_interpretation: 1,
  report_show_comments: 1,
  report_show_method: 1,
  report_show_instrument: 1
};

async function getSettings(branchId) {
  const lab=await getLaboratory(branchId);
  const [[settings]]=await pool.execute('SELECT * FROM lab_settings WHERE laboratory_id=:labId LIMIT 1',{labId:lab.id});
  return { ...DEFAULT_SETTINGS, ...(settings||{}), laboratory_id:lab.id, laboratory_name:lab.name };
}

async function getSettingsByLaboratoryId(laboratoryId) {
  const [[settings]]=await pool.execute('SELECT * FROM lab_settings WHERE laboratory_id=:labId LIMIT 1',{labId:laboratoryId});
  return { ...DEFAULT_SETTINGS, ...(settings||{}) };
}

async function saveSettings(branchId, actorUserId, payload) {
  const lab=await getLaboratory(branchId);
  const reviewUrl=String(payload.googleReviewUrl||'').trim();
  if(reviewUrl){
    let parsed;
    try{parsed=new URL(reviewUrl);}catch(_){throw new AppError('Enter a valid Google review URL.',422);}
    const host=parsed.hostname.toLowerCase();
    const allowedHosts=['google.com','g.page','maps.app.goo.gl'];
    if(parsed.protocol!=='https:'||!allowedHosts.some(domain=>host===domain||host.endsWith('.'+domain)))throw new AppError('Use a secure Google review link from Google Maps or Google Business Profile.',422);
  }
  const font=Number(payload.reportFontSizePt||10),top=Number(payload.reportMarginTopMm||10),bottom=Number(payload.reportMarginBottomMm||10);
  if(!Number.isFinite(font)||font<8||font>16)throw new AppError('Report font size must be between 8 and 16 pt.',422);
  if(!Number.isFinite(top)||top<0||top>40||!Number.isFinite(bottom)||bottom<0||bottom>40)throw new AppError('Report margins must be between 0 and 40 mm.',422);
  const values={
    labId:lab.id,reviewUrl:reviewUrl||null,reviewMessage:String(payload.reviewMessage||'').trim().slice(0,1000)||DEFAULT_SETTINGS.review_message,
    font,top,bottom,showInterpretation:payload.reportShowInterpretation==='1'?1:0,
    showComments:payload.reportShowComments==='1'?1:0,showMethod:payload.reportShowMethod==='1'?1:0,
    showInstrument:payload.reportShowInstrument==='1'?1:0,userId:actorUserId
  };
  await pool.execute(
    'INSERT INTO lab_settings (laboratory_id,google_review_url,review_message,report_font_size_pt,report_margin_top_mm,report_margin_bottom_mm,report_show_interpretation,report_show_comments,report_show_method,report_show_instrument,updated_by) VALUES (:labId,:reviewUrl,:reviewMessage,:font,:top,:bottom,:showInterpretation,:showComments,:showMethod,:showInstrument,:userId) ON DUPLICATE KEY UPDATE google_review_url=VALUES(google_review_url),review_message=VALUES(review_message),report_font_size_pt=VALUES(report_font_size_pt),report_margin_top_mm=VALUES(report_margin_top_mm),report_margin_bottom_mm=VALUES(report_margin_bottom_mm),report_show_interpretation=VALUES(report_show_interpretation),report_show_comments=VALUES(report_show_comments),report_show_method=VALUES(report_show_method),report_show_instrument=VALUES(report_show_instrument),updated_by=VALUES(updated_by)',
    values
  );
  await auditService.log({userId:actorUserId,action:'LAB_SETTINGS_UPDATED',entity:'laboratory',entityId:lab.id,newValue:{googleReviewConfigured:Boolean(reviewUrl),fontSize:font,marginTop:top,marginBottom:bottom}});
}

async function getTpaClaim(branchId, orderId) {
  const [[claim]]=await pool.execute('SELECT c.* FROM lab_tpa_claims c JOIN lab_orders o ON o.id=c.lab_order_id JOIN laboratories l ON l.id=o.laboratory_id WHERE c.lab_order_id=:orderId AND l.branch_id=:branchId LIMIT 1',{orderId,branchId});
  return claim||null;
}

async function saveTpaClaim(branchId, actorUserId, orderId, payload) {
  const insurer=String(payload.insurerName||'').trim();
  const statusOptions=['DRAFT','SUBMITTED','QUERY','APPROVED','REJECTED','SETTLED'];
  const status=statusOptions.includes(payload.status)?payload.status:'DRAFT';
  const claimAmount=Number(payload.claimAmount||0);
  const approvedAmount=String(payload.approvedAmount??'').trim()===''?null:Number(payload.approvedAmount);
  const paidAmount=Number(payload.paidAmount||0);
  if(!insurer)throw new AppError('Insurance company / TPA name is required.',422);
  if(!Number.isFinite(claimAmount)||claimAmount<0||!Number.isFinite(paidAmount)||paidAmount<0||(approvedAmount!==null&&(!Number.isFinite(approvedAmount)||approvedAmount<0)))throw new AppError('Claim, approved and paid amounts must be valid non-negative amounts.',422);
  if(paidAmount>(approvedAmount===null?claimAmount:approvedAmount))throw new AppError('Paid amount cannot exceed the approved claim amount.',422);
  return withTransaction(async conn=>{
    const [[order]]=await conn.execute('SELECT o.id,o.net_amount,o.payment_status FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id WHERE o.id=:id AND l.branch_id=:branchId FOR UPDATE',{id:orderId,branchId});
    if(!order)throw new AppError('Laboratory order not found in this branch.',404);
    if(order.payment_status==='WAIVED'&&paidAmount>0)throw new AppError('A waived order cannot record a TPA payment.',409);
    if(claimAmount>Number(order.net_amount||0)+0.005)throw new AppError('Claim amount cannot exceed the laboratory order net amount.',422);
    const [existingRows]=await conn.execute('SELECT id,created_by,paid_amount FROM lab_tpa_claims WHERE lab_order_id=:id FOR UPDATE',{id:orderId});
    const existing=existingRows[0];
    const previousTpaPaid=Number(existing?.paid_amount||0);
    if(paidAmount<previousTpaPaid)throw new AppError('TPA paid amount cannot be reduced below previously recorded payments.',422);
    const additionalTpaPayment=Math.round((paidAmount-previousTpaPaid)*100)/100;
    const [result]=await conn.execute(
      'INSERT INTO lab_tpa_claims (lab_order_id,insurer_name,policy_number,claim_number,claim_amount,approved_amount,paid_amount,status,submitted_at,settled_at,notes,created_by,updated_by) VALUES (:orderId,:insurer,:policy,:claimNumber,:claimAmount,:approvedAmount,:paidAmount,:status,IF(:status=\'SUBMITTED\',NOW(),NULL),IF(:status=\'SETTLED\',NOW(),NULL),:notes,:createdBy,:userId) ON DUPLICATE KEY UPDATE insurer_name=VALUES(insurer_name),policy_number=VALUES(policy_number),claim_number=VALUES(claim_number),claim_amount=VALUES(claim_amount),approved_amount=VALUES(approved_amount),paid_amount=VALUES(paid_amount),status=VALUES(status),submitted_at=IF(VALUES(status)=\'SUBMITTED\',COALESCE(submitted_at,NOW()),submitted_at),settled_at=IF(VALUES(status)=\'SETTLED\',COALESCE(settled_at,NOW()),settled_at),notes=VALUES(notes),updated_by=VALUES(updated_by)',
      {orderId,insurer,policy:String(payload.policyNumber||'').trim()||null,claimNumber:String(payload.claimNumber||'').trim()||null,claimAmount,approvedAmount,paidAmount,status,notes:String(payload.notes||'').trim()||null,createdBy:existing?existing.created_by:actorUserId,userId:actorUserId}
    );
    const claimId=existing?existing.id:result.insertId;
    if(additionalTpaPayment>0){
      await conn.execute('INSERT INTO lab_order_payments (lab_order_id,amount,payment_method,reference_no,notes,received_by) VALUES (:orderId,:amount,\'BANK_TRANSFER\',:reference,:notes,:userId)',{orderId,amount:additionalTpaPayment,reference:String(payload.claimNumber||'').trim()||null,notes:'TPA / insurance settlement '+(insurer||''),userId:actorUserId});
    }
    const [[paidRow]]=await conn.execute('SELECT COALESCE(SUM(amount),0) paid FROM lab_order_payments WHERE lab_order_id=:orderId',{orderId});
    const totalPaid=Number(paidRow.paid||0);
    const paymentStatus=totalPaid+0.005>=Number(order.net_amount||0)?'PAID':(totalPaid>0?'PARTIAL':'UNPAID');
    if(order.payment_status!=='WAIVED')await conn.execute('UPDATE lab_orders SET payment_status=:status WHERE id=:orderId',{status:paymentStatus,orderId});
    await auditService.log({userId:actorUserId,action:existing?'LAB_TPA_CLAIM_UPDATED':'LAB_TPA_CLAIM_CREATED',entity:'lab_tpa_claim',entityId:claimId,newValue:{orderId,insurer,claimAmount,approvedAmount,paidAmount,additionalTpaPayment,status}},conn);
    return claimId;
  });
}


async function exportRows(branchId, fromDate, toDate) {
  const [rows] = await pool.execute(
    'SELECT o.order_code,o.booking_date,p.health_id,p.name patient_name,p.gender,p.age_years,o.source,o.priority,o.status,oi.test_code_snapshot,oi.test_name_snapshot,oi.status test_status,oi.price_snapshot,CASE WHEN oi.id=(SELECT MIN(oi2.id) FROM lab_order_items oi2 WHERE oi2.lab_order_id=o.id) THEN o.net_amount ELSE 0 END net_amount,o.payment_status,CASE WHEN oi.id=(SELECT MIN(oi2.id) FROM lab_order_items oi2 WHERE oi2.lab_order_id=o.id) THEN COALESCE(pay.paid,0) ELSE 0 END paid_amount,CASE WHEN oi.id=(SELECT MIN(oi2.id) FROM lab_order_items oi2 WHERE oi2.lab_order_id=o.id) THEN (o.net_amount-COALESCE(pay.paid,0)) ELSE 0 END due_amount,o.created_at,oi.completed_at FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id JOIN patients p ON p.id=o.patient_id JOIN lab_order_items oi ON oi.lab_order_id=o.id LEFT JOIN (SELECT lab_order_id,SUM(amount) paid FROM lab_order_payments GROUP BY lab_order_id) pay ON pay.lab_order_id=o.id WHERE l.branch_id=:branchId AND o.booking_date BETWEEN :fromDate AND :toDate ORDER BY o.booking_date DESC,o.id DESC,oi.id',
    { branchId, fromDate, toDate }
  );
  return rows;
}

module.exports = {
  listPackages, getPackage, savePackage, recordPayment, getOrderPayments, getAccounting,
  createExpense, createShareToken, getPublicOrder, getPublicReport, logNotification, csvCell, exportRows,
  getSettings, getSettingsByLaboratoryId, saveSettings, getTpaClaim, saveTpaClaim, listPhlebotomists, assignHomeCollection, listLabStaff, saveLabWorker
};
