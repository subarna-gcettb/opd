
const { pool, withTransaction } = require('../config/database');
const sequenceService = require('./sequenceService');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

async function actorBranch(conn, actorUserId) {
  const [[user]] = await conn.execute('SELECT branch_id FROM users WHERE id=:id AND deleted_at IS NULL LIMIT 1', { id: actorUserId });
  if (!user || !user.branch_id) throw new AppError('Account has no branch', 403);
  return user.branch_id;
}

async function getLaboratoryForBranch(branchId, conn = pool) {
  const [[lab]] = await conn.execute(
    'SELECT id,branch_id,code,name,facility_type,address,phone,email,report_header,report_footer,signatory_name,signatory_qualification,signatory_registration_no,accreditation_body,accreditation_number FROM laboratories WHERE branch_id=:branchId AND is_active=1 AND deleted_at IS NULL ORDER BY id LIMIT 1',
    { branchId }
  );
  return lab || null;
}

async function getAvailableTestsForBranch(branchId) {
  const [rows] = await pool.execute(
    'SELECT t.id,t.code,t.name,t.short_name,t.test_type,t.specimen_type,t.container_type,t.fasting_required,t.patient_preparation,t.methodology,t.tat_minutes,t.price,t.is_accredited,c.name category_name,s.name section_name FROM lab_tests t JOIN laboratories l ON l.id=t.laboratory_id LEFT JOIN lab_test_categories c ON c.id=t.category_id LEFT JOIN lab_sections s ON s.id=t.section_id WHERE l.branch_id=:branchId AND l.is_active=1 AND l.deleted_at IS NULL AND t.is_active=1 AND t.deleted_at IS NULL ORDER BY c.sort_order,s.name,t.name',
    { branchId }
  );
  return rows;
}

async function listTests(branchId, filters = {}) {
  const params = { branchId };
  const where = ['l.branch_id=:branchId','l.is_active=1','t.is_active=1','t.deleted_at IS NULL'];
  if (filters.q) { params.q='%'+String(filters.q).trim()+'%'; where.push('(t.name LIKE :q OR t.code LIKE :q OR t.short_name LIKE :q)'); }
  if (filters.testType) { params.testType=filters.testType; where.push('t.test_type=:testType'); }
  const sql = 'SELECT t.*,s.name section_name,c.name category_name FROM lab_tests t JOIN laboratories l ON l.id=t.laboratory_id LEFT JOIN lab_sections s ON s.id=t.section_id LEFT JOIN lab_test_categories c ON c.id=t.category_id WHERE '+where.join(' AND ')+' ORDER BY c.sort_order,t.name';
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getTest(testId) {
  const [[test]] = await pool.execute(
    'SELECT t.*,l.name laboratory_name,l.branch_id,s.name section_name,c.name category_name FROM lab_tests t JOIN laboratories l ON l.id=t.laboratory_id LEFT JOIN lab_sections s ON s.id=t.section_id LEFT JOIN lab_test_categories c ON c.id=t.category_id WHERE t.id=:id AND t.deleted_at IS NULL',
    { id:testId }
  );
  if (!test) return null;
  const [parameters] = await pool.execute('SELECT p.* FROM lab_test_parameters p WHERE p.test_id=:testId AND p.is_active=1 ORDER BY p.sort_order,p.name',{testId});
  return {test,parameters};
}

async function createTest(branchId,payload,actorUserId) {
  return withTransaction(async conn=>{
    const lab=await getLaboratoryForBranch(branchId,conn);
    if(!lab) throw new AppError('No active laboratory/diagnostic centre is configured',409);
    if(!payload.code || !payload.name) throw new AppError('Test code and test name are required',422);
    const [r]=await conn.execute(
      'INSERT INTO lab_tests (laboratory_id,section_id,category_id,code,name,short_name,test_type,specimen_type,container_type,fasting_required,patient_preparation,methodology,tat_minutes,price,is_accredited) VALUES (:labId,:sectionId,:categoryId,:code,:name,:shortName,:testType,:specimenType,:containerType,:fasting,:preparation,:methodology,:tat,:price,:accredited)',
      {labId:lab.id,sectionId:payload.sectionId||null,categoryId:payload.categoryId||null,code:String(payload.code).trim().toUpperCase(),name:String(payload.name).trim(),shortName:String(payload.shortName||'').trim()||null,testType:payload.testType||'LAB',specimenType:String(payload.specimenType||'').trim()||null,containerType:String(payload.containerType||'').trim()||null,fasting:payload.fastingRequired?1:0,preparation:String(payload.patientPreparation||'').trim()||null,methodology:String(payload.methodology||'').trim()||null,tat:Math.max(1,Number(payload.tatMinutes)||1440),price:Math.max(0,Number(payload.price)||0),accredited:payload.isAccredited?1:0}
    );
    await auditService.log({userId:actorUserId,action:'LAB_TEST_CREATED',entity:'lab_test',entityId:r.insertId,newValue:{code:payload.code,name:payload.name}},conn);
    return r.insertId;
  });
}

async function updateTest(testId,payload,actorUserId) {
  return withTransaction(async conn=>{
    const [[old]]=await conn.execute('SELECT * FROM lab_tests WHERE id=:id AND deleted_at IS NULL FOR UPDATE',{id:testId});
    if(!old) throw new AppError('Laboratory test not found',404);
    await conn.execute(
      'UPDATE lab_tests SET section_id=:sectionId,category_id=:categoryId,code=:code,name=:name,short_name=:shortName,test_type=:testType,specimen_type=:specimenType,container_type=:containerType,fasting_required=:fasting,patient_preparation=:preparation,methodology=:methodology,tat_minutes=:tat,price=:price,is_accredited=:accredited,is_active=:active WHERE id=:id',
      {id:testId,sectionId:payload.sectionId||null,categoryId:payload.categoryId||null,code:String(payload.code).trim().toUpperCase(),name:String(payload.name).trim(),shortName:String(payload.shortName||'').trim()||null,testType:payload.testType||'LAB',specimenType:String(payload.specimenType||'').trim()||null,containerType:String(payload.containerType||'').trim()||null,fasting:payload.fastingRequired?1:0,preparation:String(payload.patientPreparation||'').trim()||null,methodology:String(payload.methodology||'').trim()||null,tat:Math.max(1,Number(payload.tatMinutes)||1440),price:Math.max(0,Number(payload.price)||0),accredited:payload.isAccredited?1:0,active:payload.isActive===undefined?1:(payload.isActive?1:0)}
    );
    await auditService.log({userId:actorUserId,action:'LAB_TEST_UPDATED',entity:'lab_test',entityId:testId,oldValue:{code:old.code,name:old.name,price:old.price},newValue:{code:payload.code,name:payload.name,price:payload.price}},conn);
  });
}

async function saveTestParameters(testId,payload,actorUserId) {
  return withTransaction(async (conn) => {
    const [[test]] = await conn.execute('SELECT id FROM lab_tests WHERE id=:id AND deleted_at IS NULL FOR UPDATE',{id:testId});
    if (!test) throw new AppError('Laboratory test not found',404);
    const ids = Array.isArray(payload.parameterId) ? payload.parameterId : (payload.parameterId ? [payload.parameterId] : []);
    const names = Array.isArray(payload.parameterName) ? payload.parameterName : (payload.parameterName ? [payload.parameterName] : []);
    const codes = Array.isArray(payload.parameterCode) ? payload.parameterCode : (payload.parameterCode ? [payload.parameterCode] : []);
    const types = Array.isArray(payload.parameterType) ? payload.parameterType : (payload.parameterType ? [payload.parameterType] : []);
    const units = Array.isArray(payload.parameterUnit) ? payload.parameterUnit : (payload.parameterUnit ? [payload.parameterUnit] : []);
    const refs = Array.isArray(payload.referenceRange) ? payload.referenceRange : (payload.referenceRange ? [payload.referenceRange] : []);
    const lows = Array.isArray(payload.criticalLow) ? payload.criticalLow : (payload.criticalLow ? [payload.criticalLow] : []);
    const highs = Array.isArray(payload.criticalHigh) ? payload.criticalHigh : (payload.criticalHigh ? [payload.criticalHigh] : []);
    const kept=[];
    for(let i=0;i<names.length;i++){
      const name=String(names[i]||'').trim(); if(!name) continue;
      const id=Number(ids[i]||0); const code=String(codes[i]||('P'+(i+1))).trim().toUpperCase();
      const dataType=['TEXT','NUMERIC','POSITIVE_NEGATIVE','SELECT','BOOLEAN'].includes(types[i])?types[i]:'TEXT';
      const unit=String(units[i]||'').trim()||null;
      const range=String(refs[i]||'').trim()||null;
      const low=lows[i]!==undefined&&lows[i]!==''?Number(lows[i]):null;
      const high=highs[i]!==undefined&&highs[i]!==''?Number(highs[i]):null;
      if(id){
        await conn.execute('UPDATE lab_test_parameters SET code=:code,name=:name,data_type=:dataType,unit=:unit,reference_range_text=:rangeText,critical_low=:low,critical_high=:high,is_active=1,sort_order=:sortOrder WHERE id=:id AND test_id=:testId',{id,testId,code,name,dataType,unit,rangeText:range,low,high,sortOrder:i+1});
        kept.push(id);
      }else{
        const [r]=await conn.execute('INSERT INTO lab_test_parameters (test_id,code,name,data_type,unit,reference_range_text,critical_low,critical_high,sort_order,is_active) VALUES (:testId,:code,:name,:dataType,:unit,:rangeText,:low,:high,:sortOrder,1)',{testId,code,name,dataType,unit,rangeText:range,low,high,sortOrder:i+1});
        kept.push(r.insertId);
      }
    }
    if(kept.length){
      const placeholders=kept.map((_,i)=>':p'+i).join(',');
      const params={testId}; kept.forEach((id,i)=>params['p'+i]=id);
      await conn.execute('UPDATE lab_test_parameters SET is_active=0 WHERE test_id=:testId AND id NOT IN ('+placeholders+')',params);
    }else{
      await conn.execute('UPDATE lab_test_parameters SET is_active=0 WHERE test_id=:testId',{testId});
    }
    await auditService.log({userId:actorUserId,action:'LAB_TEST_PARAMETERS_UPDATED',entity:'lab_test',entityId:testId,newValue:{parameterCount:kept.length}},conn);
  });
}

async function createOrder(patientId,branchId,actorUserId,payload={}) {
  return withTransaction(async conn=>{
    const [[patient]]=await conn.execute('SELECT id,name,health_id,branch_id FROM patients WHERE id=:id AND deleted_at IS NULL FOR UPDATE',{id:patientId});
    if(!patient) throw new AppError('Patient not found',404);
    const lab=await getLaboratoryForBranch(branchId||patient.branch_id,conn);
    if(!lab) throw new AppError('No active laboratory/diagnostic centre is configured',409);
    const ids=[...new Set((payload.testIds||[]).map(Number).filter(Number.isInteger))];
    if(!ids.length) throw new AppError('Select at least one test',422);
    const placeholders=ids.map((_,i)=>':t'+i).join(',');
    const tp={labId:lab.id}; ids.forEach((id,i)=>tp['t'+i]=id);
    const [tests]=await conn.execute('SELECT id,code,name,test_type,specimen_type,price FROM lab_tests WHERE laboratory_id=:labId AND is_active=1 AND deleted_at IS NULL AND id IN ('+placeholders+')',tp);
    if(tests.length!==ids.length) throw new AppError('One or more selected tests are unavailable',422);
    const year=new Date().getFullYear();
    const seq=await sequenceService.nextValue(conn,'lab-order:'+year+':'+lab.id);
    const orderCode='LAB'+year+sequenceService.pad(seq,6);
    const source=['DOCTOR','PATIENT','RECEPTION','LAB'].includes(payload.source)?payload.source:'RECEPTION';
    const status=source==='PATIENT'?'BOOKED':(source==='DOCTOR'?'ORDERED':'BOOKED');
    const total=tests.reduce((n,t)=>n+Number(t.price||0),0);
    const [r]=await conn.execute('INSERT INTO lab_orders (order_code,patient_id,visit_id,laboratory_id,source,ordered_by,booking_date,priority,status,clinical_notes,total_amount,net_amount,payment_status) VALUES (:code,:patientId,:visitId,:labId,:source,:userId,:date,:priority,:status,:notes,:total,:total,"UNBILLED")',{code:orderCode,patientId,visitId:payload.visitId||null,labId:lab.id,source,userId:actorUserId,date:payload.bookingDate||new Date().toISOString().slice(0,10),priority:payload.priority||'ROUTINE',status,notes:payload.clinicalNotes||null,total});
    for(const t of tests) await conn.execute('INSERT INTO lab_order_items (lab_order_id,test_id,test_code_snapshot,test_name_snapshot,test_type_snapshot,specimen_type_snapshot,price_snapshot,status,scheduled_date) VALUES (:orderId,:testId,:code,:name,:type,:specimen,:price,:status,:date)',{orderId:r.insertId,testId:t.id,code:t.code,name:t.name,type:t.test_type,specimen:t.specimen_type,price:t.price,status:source==='DOCTOR'?'ORDERED':'BOOKED',date:payload.bookingDate||new Date().toISOString().slice(0,10)});
    await conn.execute('INSERT INTO lab_order_status_history (lab_order_id,old_status,new_status,changed_by,note) VALUES (:orderId,NULL,:status,:userId,:note)',{orderId:r.insertId,status,userId:actorUserId,note:'Created from '+source.toLowerCase()+' workflow'});
    await auditService.log({userId:actorUserId,action:'LAB_ORDER_CREATED',entity:'lab_order',entityId:r.insertId,newValue:{orderCode,patientId,source,testIds:ids}},conn);
    return {id:r.insertId,orderCode,patient,lab,tests};
  });
}

async function syncDoctorRequestedTests(conn,visitId,patientId,branchId,selectedTestIds,actorUserId) {
  const ids=[...new Set((selectedTestIds||[]).map(Number).filter(Number.isInteger))];
  const lab=await getLaboratoryForBranch(branchId,conn);
  if(!lab) return {orderId:null,count:0};
  let [[order]]=await conn.execute('SELECT * FROM lab_orders WHERE visit_id=:visitId AND source="DOCTOR" AND laboratory_id=:labId AND status<>"CANCELLED" ORDER BY id DESC LIMIT 1 FOR UPDATE',{visitId,labId:lab.id});
  if(!ids.length) {
    if(order) {
      await conn.execute('UPDATE lab_order_items SET status="CANCELLED",cancellation_reason="Doctor removed the test request" WHERE lab_order_id=:orderId AND status IN ("ORDERED","BOOKED")',{orderId:order.id});
      await conn.execute('UPDATE lab_orders SET status="CANCELLED",cancelled_at=NOW(),cancelled_by=:userId,cancellation_reason="Doctor removed all requested diagnostic tests" WHERE id=:orderId',{orderId:order.id,userId:actorUserId});
    }
    return {orderId:order?order.id:null,count:0};
  }
  const placeholders=ids.map((_,i)=>':id'+i).join(',');
  const p={labId:lab.id}; ids.forEach((id,i)=>p['id'+i]=id);
  const [tests]=await conn.execute('SELECT id,code,name,test_type,specimen_type,price FROM lab_tests WHERE laboratory_id=:labId AND is_active=1 AND deleted_at IS NULL AND id IN ('+placeholders+')',p);
  if(tests.length!==ids.length) throw new AppError('A selected test is not available at this centre',422);
  if(!order) {
    const seq=await sequenceService.nextValue(conn,'lab-order:'+new Date().getFullYear()+':'+lab.id);
    const code='LAB'+new Date().getFullYear()+sequenceService.pad(seq,6);
    const [r]=await conn.execute('INSERT INTO lab_orders (order_code,patient_id,visit_id,laboratory_id,source,ordered_by,booking_date,status,total_amount,net_amount) VALUES (:code,:patientId,:visitId,:labId,"DOCTOR",:userId,CURDATE(),"ORDERED",0,0)',{code,patientId,visitId,labId:lab.id,userId:actorUserId});
    [[order]]=await conn.execute('SELECT * FROM lab_orders WHERE id=:id FOR UPDATE',{id:r.insertId});
  }
  const [existing]=await conn.execute('SELECT id,test_id,status FROM lab_order_items WHERE lab_order_id=:orderId',{orderId:order.id});
  const map=new Map(existing.map(x=>[Number(x.test_id),x]));
  for(const t of tests){
    const old=map.get(Number(t.id));
    if(!old) await conn.execute('INSERT INTO lab_order_items (lab_order_id,test_id,test_code_snapshot,test_name_snapshot,test_type_snapshot,specimen_type_snapshot,price_snapshot,status,scheduled_date) VALUES (:orderId,:testId,:code,:name,:type,:specimen,:price,"ORDERED",CURDATE())',{orderId:order.id,testId:t.id,code:t.code,name:t.name,type:t.test_type,specimen:t.specimen_type,price:t.price});
    else if(old.status==='CANCELLED') await conn.execute('UPDATE lab_order_items SET status="ORDERED",cancellation_reason=NULL WHERE id=:id',{id:old.id});
  }
  const keep=new Set(ids.map(Number));
  for(const item of existing) if(!keep.has(Number(item.test_id)) && ['ORDERED','BOOKED'].includes(item.status)) await conn.execute('UPDATE lab_order_items SET status="CANCELLED",cancellation_reason="Doctor removed the test request" WHERE id=:id',{id:item.id});
  await recalcOrder(conn,order.id,actorUserId);
  await auditService.log({userId:actorUserId,action:'LAB_DOCTOR_REFERRAL_SYNCED',entity:'lab_order',entityId:order.id,newValue:{selectedTestIds:ids}},conn);
  return {orderId:order.id,count:ids.length};
}

async function listOrders(branchId,filters={}) {
  const params={branchId}; const where=['l.branch_id=:branchId'];
  if(filters.status){params.status=filters.status;where.push('o.status=:status');}
  if(filters.q){params.q='%'+String(filters.q).trim()+'%';where.push('(o.order_code LIKE :q OR p.health_id LIKE :q OR p.name LIKE :q)');}
  const [rows]=await pool.execute('SELECT o.id,o.order_code,o.booking_date,o.source,o.priority,o.status,o.total_amount,o.net_amount,o.payment_status,o.created_at,p.health_id,p.name patient_name,l.name laboratory_name,COUNT(oi.id) total_tests,SUM(oi.status="REPORTED") reported_tests FROM lab_orders o JOIN patients p ON p.id=o.patient_id JOIN laboratories l ON l.id=o.laboratory_id LEFT JOIN lab_order_items oi ON oi.lab_order_id=o.id WHERE '+where.join(' AND ')+' GROUP BY o.id ORDER BY o.created_at DESC LIMIT 250',params);
  return rows;
}

async function getOrder(orderId) {
  const [[order]]=await pool.execute('SELECT o.*,p.health_id,p.name patient_name,p.gender,p.age_years,p.dob,p.mobile,l.name laboratory_name,l.address laboratory_address,l.phone laboratory_phone,l.email laboratory_email,l.report_header,l.report_footer,l.signatory_name,l.signatory_qualification,l.signatory_registration_no,v.visit_code,du.name ordered_by_name FROM lab_orders o JOIN patients p ON p.id=o.patient_id JOIN laboratories l ON l.id=o.laboratory_id LEFT JOIN opd_visits v ON v.id=o.visit_id LEFT JOIN users du ON du.id=o.ordered_by WHERE o.id=:id',{id:orderId});
  if(!order)return null;
  const [items]=await pool.execute('SELECT oi.*,t.methodology,t.fasting_required,t.patient_preparation,t.tat_minutes,t.is_accredited,s.name section_name,lr.id result_id,lr.version result_version,lr.status result_status,ls.id sample_id,ls.sample_code,ls.barcode_value,ls.status sample_status FROM lab_order_items oi JOIN lab_tests t ON t.id=oi.test_id LEFT JOIN lab_sections s ON s.id=t.section_id LEFT JOIN lab_results lr ON lr.lab_order_item_id=oi.id AND lr.is_current=1 LEFT JOIN lab_samples ls ON ls.lab_order_item_id=oi.id WHERE oi.lab_order_id=:orderId ORDER BY s.name,oi.test_name_snapshot',{orderId});
  const [history]=await pool.execute('SELECT h.*,u.name changed_by_name FROM lab_order_status_history h JOIN users u ON u.id=h.changed_by WHERE h.lab_order_id=:orderId ORDER BY h.created_at DESC',{orderId});
  return {order,items,history};
}

async function collectSample(itemId,actorUserId,payload={}) {
  return withTransaction(async conn=>{
    const branchId = await actorBranch(conn, actorUserId);
    const [[item]]=await conn.execute('SELECT oi.*,o.order_code,o.patient_id,o.branch_id FROM lab_order_items oi JOIN lab_orders o ON o.id=oi.lab_order_id WHERE oi.id=:id AND o.branch_id=:branchId FOR UPDATE',{id:itemId,branchId});
    if(!item)throw new AppError('Laboratory order item not found',404);
    if(['CANCELLED','REJECTED','REPORTED'].includes(item.status))throw new AppError('This test cannot accept a sample now',409);
    const [[existing]]=await conn.execute('SELECT id,sample_code,barcode_value FROM lab_samples WHERE lab_order_item_id=:id AND status NOT IN ("REJECTED","DISPOSED") ORDER BY id DESC LIMIT 1 FOR UPDATE',{id:itemId});
    let sampleCode,barcode;
    if(existing){sampleCode=existing.sample_code;barcode=existing.barcode_value;await conn.execute('UPDATE lab_samples SET status="COLLECTED",collected_at=NOW(),collected_by=:userId,specimen_type=:specimen,container_type=:container,volume=:volume WHERE id=:id',{id:existing.id,userId:actorUserId,specimen:payload.specimenType||item.specimen_type_snapshot||'Sample',container:payload.containerType||null,volume:payload.volume||null});}
    else{const seq=await sequenceService.nextValue(conn,'lab-sample:'+new Date().getFullYear()+':'+item.lab_order_id);sampleCode='SMP'+new Date().getFullYear()+sequenceService.pad(seq,6);barcode='CHB'+new Date().getFullYear()+sequenceService.pad(seq,8);await conn.execute('INSERT INTO lab_samples (sample_code,barcode_value,lab_order_item_id,specimen_type,container_type,volume,collected_at,collected_by,status) VALUES (:sampleCode,:barcode,:itemId,:specimen,:container,:volume,NOW(),:userId,"COLLECTED")',{sampleCode,barcode,itemId,specimen:payload.specimenType||item.specimen_type_snapshot||'Sample',container:payload.containerType||null,volume:payload.volume||null,userId:actorUserId});}
    await conn.execute('UPDATE lab_order_items SET status="COLLECTED" WHERE id=:id',{id:itemId});
    await recalcOrder(conn,item.lab_order_id,actorUserId);
    await auditService.log({userId:actorUserId,action:'LAB_SAMPLE_COLLECTED',entity:'lab_order_item',entityId:itemId,newValue:{sampleCode,barcode}},conn);
    return {sampleCode,barcode};
  });
}

async function receiveSample(itemId,actorUserId) {
  return withTransaction(async conn=>{
    const branchId = await actorBranch(conn, actorUserId);
    const [[s]]=await conn.execute('SELECT s.*,oi.lab_order_id FROM lab_samples s JOIN lab_order_items oi ON oi.id=s.lab_order_item_id JOIN lab_orders o ON o.id=oi.lab_order_id WHERE oi.id=:itemId AND o.branch_id=:branchId ORDER BY s.id DESC LIMIT 1 FOR UPDATE',{itemId,branchId});
    if(!s)throw new AppError('No sample found',404);
    if(s.status==='REJECTED')throw new AppError('Sample already rejected',409);
    await conn.execute('UPDATE lab_samples SET status="RECEIVED",received_at=NOW(),received_by=:userId WHERE id=:id',{id:s.id,userId:actorUserId});
    await conn.execute('UPDATE lab_order_items SET status="RECEIVED" WHERE id=:id',{id:itemId});
    await recalcOrder(conn,s.lab_order_id,actorUserId);
  });
}

async function rejectSample(itemId,actorUserId,reason) {
  return withTransaction(async conn=>{
    if(!String(reason||'').trim())throw new AppError('Sample rejection reason is required',422);
    const branchId = await actorBranch(conn, actorUserId);
    const [[s]]=await conn.execute('SELECT s.*,oi.lab_order_id FROM lab_samples s JOIN lab_order_items oi ON oi.id=s.lab_order_item_id JOIN lab_orders o ON o.id=oi.lab_order_id WHERE oi.id=:itemId AND o.branch_id=:branchId ORDER BY s.id DESC LIMIT 1 FOR UPDATE',{itemId,branchId});
    if(!s)throw new AppError('No sample found',404);
    await conn.execute('UPDATE lab_samples SET status="REJECTED",rejection_reason=:reason WHERE id=:id',{id:s.id,reason:String(reason).trim()});
    await conn.execute('UPDATE lab_order_items SET status="REJECTED",rejected_reason=:reason WHERE id=:itemId',{itemId,reason:String(reason).trim()});
    await recalcOrder(conn,s.lab_order_id);
    await auditService.log({userId:actorUserId,action:'LAB_SAMPLE_REJECTED',entity:'lab_sample',entityId:s.id,newValue:{reason}},conn);
  });
}

async function getResult(resultId) {
  const [[result]]=await pool.execute('SELECT r.*,oi.lab_order_id,oi.test_id,oi.test_name_snapshot,oi.test_code_snapshot,o.order_code,o.patient_id,o.visit_id,p.health_id,p.name patient_name,p.gender,p.age_years,p.dob,l.name laboratory_name,l.address laboratory_address,l.phone laboratory_phone,l.email laboratory_email,l.report_header,l.report_footer,l.signatory_name,l.signatory_qualification,l.signatory_registration_no,pu.name performer_name,ru.name reviewer_name,au.name releaser_name FROM lab_results r JOIN lab_order_items oi ON oi.id=r.lab_order_item_id JOIN lab_orders o ON o.id=oi.lab_order_id JOIN patients p ON p.id=o.patient_id JOIN laboratories l ON l.id=o.laboratory_id LEFT JOIN users pu ON pu.id=r.performed_by LEFT JOIN users ru ON ru.id=r.reviewed_by LEFT JOIN users au ON au.id=r.released_by WHERE r.id=:id',{id:resultId});
  if(!result)return null;
  const [parameters]=await pool.execute('SELECT p.*,rv.value_text,rv.value_numeric,rv.unit_snapshot,rv.reference_range_snapshot,rv.abnormal_flag,rv.remarks FROM lab_test_parameters p LEFT JOIN lab_result_values rv ON rv.parameter_id=p.id AND rv.result_id=:resultId WHERE p.test_id=:testId AND p.is_active=1 ORDER BY p.sort_order,p.name',{resultId,testId:result.test_id});
  return {result,parameters};
}

async function saveResult(itemId,actorUserId,payload,mode='enter') {
  return withTransaction(async conn=>{
    const branchId = await actorBranch(conn, actorUserId);
    const [[item]]=await conn.execute('SELECT oi.*,o.order_code,o.patient_id,o.branch_id,t.name test_name,t.methodology FROM lab_order_items oi JOIN lab_orders o ON o.id=oi.lab_order_id JOIN lab_tests t ON t.id=oi.test_id WHERE oi.id=:id AND o.branch_id=:branchId FOR UPDATE',{id:itemId,branchId});
    if(!item)throw new AppError('Laboratory order item not found',404);
    if(['CANCELLED','REJECTED'].includes(item.status))throw new AppError('This test is not editable',409);
    const [[current]]=await conn.execute('SELECT * FROM lab_results WHERE lab_order_item_id=:itemId AND is_current=1 ORDER BY version DESC LIMIT 1 FOR UPDATE',{itemId});
    if(current&&current.status==='RELEASED'&&mode!=='amend')throw new AppError('Released report requires amendment workflow',409);
    let resultId,version=current?Number(current.version):1;
    if(current&&current.status!=='RELEASED'){resultId=current.id;await conn.execute('UPDATE lab_results SET status="RESULT_ENTERED",result_summary=:summary,interpretation=:interpretation,comments=:comments,instrument_name=:instrument,method_used=:method,performed_by=:userId,performed_at=NOW() WHERE id=:id',{id:resultId,summary:payload.resultSummary||null,interpretation:payload.interpretation||null,comments:payload.comments||null,instrument:payload.instrumentName||null,method:payload.methodUsed||item.methodology||null,userId:actorUserId});}
    else{if(current){version++;await conn.execute('UPDATE lab_results SET is_current=0 WHERE id=:id',{id:current.id});}const [r]=await conn.execute('INSERT INTO lab_results (lab_order_item_id,version,status,result_summary,interpretation,comments,instrument_name,method_used,performed_by,performed_at,is_current) VALUES (:itemId,:version,"RESULT_ENTERED",:summary,:interpretation,:comments,:instrument,:method,:userId,NOW(),1)',{itemId,version,summary:payload.resultSummary||null,interpretation:payload.interpretation||null,comments:payload.comments||null,instrument:payload.instrumentName||null,method:payload.methodUsed||item.methodology||null,userId:actorUserId});resultId=r.insertId;if(current&&mode==='amend')await conn.execute('INSERT INTO lab_result_amendments (result_id,old_version,new_version,reason,amended_by) VALUES (:resultId,:oldVersion,:newVersion,:reason,:userId)',{resultId,oldVersion:current.version,newVersion:version,reason:String(payload.amendmentReason||'Report amended').trim(),userId:actorUserId});}
    await conn.execute('DELETE FROM lab_result_values WHERE result_id=:resultId',{resultId});
    const [params]=await conn.execute('SELECT id,unit,reference_range_text,critical_low,critical_high FROM lab_test_parameters WHERE test_id=:testId AND is_active=1 ORDER BY sort_order',{testId:item.test_id});
    for(const p of params){const raw=payload.values&&payload.values[p.id]!==undefined?payload.values[p.id]:'';const value=String(raw??'').trim();if(!value)continue;const num=Number(value),numeric=Number.isFinite(num);let flag='NORMAL';if(numeric&&p.critical_low!==null&&num<Number(p.critical_low))flag='CRITICAL_LOW';else if(numeric&&p.critical_high!==null&&num>Number(p.critical_high))flag='CRITICAL_HIGH';await conn.execute('INSERT INTO lab_result_values (result_id,parameter_id,value_text,value_numeric,unit_snapshot,reference_range_snapshot,abnormal_flag,remarks) VALUES (:resultId,:parameterId,:valueText,:valueNumeric,:unit,:rangeText,:flag,:remarks)',{resultId,parameterId:p.id,valueText:value,valueNumeric:numeric?num:null,unit:p.unit||null,rangeText:p.reference_range_text||null,flag,remarks:payload.remarks&&payload.remarks[p.id]?String(payload.remarks[p.id]).trim():null});}
    await conn.execute('UPDATE lab_order_items SET status="RESULT_ENTERED" WHERE id=:id',{id:itemId});await recalcOrder(conn,item.lab_order_id);
    await auditService.log({userId:actorUserId,action:mode==='amend'?'LAB_RESULT_AMENDED':'LAB_RESULT_ENTERED',entity:'lab_result',entityId:resultId,newValue:{itemId,version}},conn);
    return {resultId,version};
  });
}

async function verifyResult(resultId,actorUserId) {
  return withTransaction(async conn=>{
    const [[r]]=await conn.execute('SELECT r.*,oi.lab_order_id FROM lab_results r JOIN lab_order_items oi ON oi.id=r.lab_order_item_id WHERE r.id=:id AND r.is_current=1 FOR UPDATE',{id:resultId});
    if(!r)throw new AppError('Current result not found',404);if(r.status!=='RESULT_ENTERED')throw new AppError('Only entered results can be verified',409);
    await conn.execute('UPDATE lab_results SET status="VERIFIED",reviewed_by=:userId,reviewed_at=NOW() WHERE id=:id',{id:resultId,userId:actorUserId});await conn.execute('UPDATE lab_order_items SET status="VERIFIED" WHERE id=:id',{id:r.lab_order_item_id});await recalcOrder(conn,r.lab_order_id);
    await auditService.log({userId:actorUserId,action:'LAB_RESULT_VERIFIED',entity:'lab_result',entityId:resultId},conn);
  });
}

async function releaseResult(resultId,actorUserId) {
  return withTransaction(async conn=>{
    const [[r]]=await conn.execute('SELECT r.*,oi.lab_order_id FROM lab_results r JOIN lab_order_items oi ON oi.id=r.lab_order_item_id WHERE r.id=:id AND r.is_current=1 FOR UPDATE',{id:resultId});
    if(!r)throw new AppError('Current result not found',404);if(r.status!=='VERIFIED')throw new AppError('Result must be verified before release',409);
    await conn.execute('UPDATE lab_results SET status="RELEASED",released_by=:userId,released_at=NOW() WHERE id=:id',{id:resultId,userId:actorUserId});await conn.execute('UPDATE lab_order_items SET status="REPORTED",completed_at=NOW() WHERE id=:id',{id:r.lab_order_item_id});await recalcOrder(conn,r.lab_order_id);
    await auditService.log({userId:actorUserId,action:'LAB_RESULT_RELEASED',entity:'lab_result',entityId:resultId},conn);
  });
}

async function attachReportFile(resultId,actorUserId,file) {
  if(!file)throw new AppError('Select a report file',422);
  return withTransaction(async conn=>{
    const branchId = await actorBranch(conn, actorUserId);
    const [[r]]=await conn.execute('SELECT r.id,r.status FROM lab_results r JOIN lab_order_items oi ON oi.id=r.lab_order_item_id JOIN lab_orders o ON o.id=oi.lab_order_id WHERE r.id=:id AND r.is_current=1 AND o.branch_id=:branchId FOR UPDATE',{id:resultId,branchId});
    if(!r)throw new AppError('Current result not found',404);if(r.status==='RELEASED')throw new AppError('Released report file cannot be replaced directly',409);
    await conn.execute('UPDATE lab_results SET report_file_name=:name,report_storage_path=:path,report_mime_type=:mime,report_file_size=:size WHERE id=:id',{id:resultId,name:file.originalname,path:file.path,mime:file.mimetype,size:file.size});
    await auditService.log({userId:actorUserId,action:'LAB_REPORT_FILE_ATTACHED',entity:'lab_result',entityId:resultId,newValue:{name:file.originalname,mime:file.mimetype,size:file.size}},conn);
  });
}

async function cancelOrder(orderId,actorUserId,reason,patientInitiated=false) {
  return withTransaction(async conn=>{
    const branchId = await actorBranch(conn, actorUserId);
    const [[o]]=await conn.execute('SELECT * FROM lab_orders WHERE id=:id AND branch_id=:branchId FOR UPDATE',{id:orderId,branchId});
    if(!o)throw new AppError('Laboratory order not found',404);if(['PROCESSING','PARTIALLY_REPORTED','REPORTED'].includes(o.status))throw new AppError('This order can no longer be cancelled',409);if(o.status==='CANCELLED')throw new AppError('Order already cancelled',409);
    const why=String(reason||(patientInitiated?'Cancelled by patient':'Cancelled by laboratory')).trim();
    await conn.execute('UPDATE lab_order_items SET status="CANCELLED",cancellation_reason=:reason WHERE lab_order_id=:id AND status<>"REPORTED"',{id:orderId,reason:why});
    await conn.execute('UPDATE lab_orders SET status="CANCELLED",cancelled_at=NOW(),cancelled_by=:userId,patient_cancelled_at=CASE WHEN :patient=1 THEN NOW() ELSE patient_cancelled_at END,cancellation_reason=:reason WHERE id=:id',{id:orderId,userId:actorUserId,patient:patientInitiated?1:0,reason:why});
    await conn.execute('INSERT INTO lab_order_status_history (lab_order_id,old_status,new_status,changed_by,note) VALUES (:id,:oldStatus,"CANCELLED",:userId,:reason)',{id:orderId,oldStatus:o.status,userId:actorUserId,reason:why});
    await auditService.log({userId:actorUserId,action:patientInitiated?'LAB_ORDER_CANCELLED_BY_PATIENT':'LAB_ORDER_CANCELLED',entity:'lab_order',entityId:orderId,newValue:{reason:why}},conn);
  });
}

async function patientOrders(patientId) {
  const [rows]=await pool.execute('SELECT o.id,o.order_code,o.booking_date,o.source,o.priority,o.status,o.total_amount,o.net_amount,o.payment_status,o.created_at,o.cancellation_reason,l.name laboratory_name,COUNT(oi.id) total_tests,SUM(oi.status="REPORTED") reported_tests FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id LEFT JOIN lab_order_items oi ON oi.lab_order_id=o.id WHERE o.patient_id=:patientId GROUP BY o.id ORDER BY o.created_at DESC',{patientId});
  return rows;
}

async function patientReport(resultId,patientId) {
  const data=await getResult(resultId);
  return data && Number(data.result.patient_id)===Number(patientId) && data.result.status==='RELEASED' ? data : null;
}

async function recalcOrder(conn,orderId,actorUserId=null) {
  const [[s]]=await conn.execute('SELECT COUNT(*) total,SUM(status="REPORTED") reported,SUM(status IN ("CANCELLED","REJECTED")) closed,SUM(status IN ("COLLECTED","RECEIVED","PROCESSING","RESULT_ENTERED","VERIFIED")) processing FROM lab_order_items WHERE lab_order_id=:id',{id:orderId});
  const total=Number(s.total||0),reported=Number(s.reported||0),closed=Number(s.closed||0),processing=Number(s.processing||0);
  let status='ORDERED';if(!total||closed===total)status='CANCELLED';else if(reported===total)status='REPORTED';else if(reported>0)status='PARTIALLY_REPORTED';else if(processing>0)status='PROCESSING';else{const [[o]]=await conn.execute('SELECT status FROM lab_orders WHERE id=:id',{id:orderId});status=o&&o.status==='BOOKED'?'BOOKED':'ORDERED';}
  const [[currentOrder]] = await conn.execute('SELECT status FROM lab_orders WHERE id=:id FOR UPDATE',{id:orderId});
  if(currentOrder && currentOrder.status !== status){
    await conn.execute('UPDATE lab_orders SET status=:status WHERE id=:id',{status,id:orderId});
    if(actorUserId){
      await conn.execute(
        'INSERT INTO lab_order_status_history (lab_order_id,old_status,new_status,changed_by,note) VALUES (:id,:oldStatus,:newStatus,:userId,:note)',
        {id:orderId,oldStatus:currentOrder.status,newStatus:status,userId:actorUserId,note:'LIS workflow status updated'}
      );
    }
  }
}

module.exports={getLaboratoryForBranch,getAvailableTestsForBranch,listTests,getTest,createTest,updateTest,saveTestParameters,createOrder,syncDoctorRequestedTests,listOrders,getOrder,collectSample,receiveSample,rejectSample,getResult,saveResult,verifyResult,releaseResult,attachReportFile,cancelOrder,patientOrders,patientReport};
