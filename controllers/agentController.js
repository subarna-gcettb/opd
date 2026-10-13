const { pool } = require('../config/database');
const agentService = require('../services/agentService');
const opdService = require('../services/opdService');
const AppError = require('../utils/AppError');

function branchId(req) {
  if (!req.user || !req.user.branch_id) throw new AppError('Agent account has no branch assigned', 403);
  return req.user.branch_id;
}

async function dashboard(req,res,next){
  try {
    const bid=branchId(req);
    const stats=await agentService.dashboard(req.user.id,bid);
    const referrals=await agentService.referralStats(bid);
    res.render('agent/dashboard',{title:'Agent Portal',stats,referrals:referrals.slice(0,10)});
  } catch(err){next(err);}
}

async function patients(req,res,next){
  try {
    const rows=await agentService.patientList(req.user.id,branchId(req),req.query.q||'');
    res.render('agent/patients',{title:'Agent Patient List',patients:rows,q:req.query.q||''});
  } catch(err){next(err);}
}

async function newPatient(req,res,next){
  try {
    const referralProviders = await agentService.getReferralProviders();
    res.render('agent/patient-new',{title:'Register Patient — Agent Portal',today:new Date().toISOString().slice(0,10),referralProviders,selectedReferralCode:agentService.referralCode(req.query.referralCode,req.user.id)});
  } catch(err){next(err);}
}

async function createPatient(req,res,next){
  try {
    const name=String(req.body.name||'').trim();
    const mobile=String(req.body.mobile||'').trim();
    const gender=String(req.body.gender||'').trim();
    if(!name || !gender || !mobile || !req.body.referralCode){
      throw new AppError('Patient name, gender, mobile number and referral number are required.',422);
    }
    if(!/^[6-9]\d{9}$/.test(mobile)){
      throw new AppError('Enter a valid 10-digit Indian mobile number.',422);
    }
    const result=await agentService.registerPatient(req.body,req.user.id,branchId(req));
    req.flash('success',`Patient registered successfully. Health ID: ${result.healthId}`);
    res.redirect('/agent/patients?registered='+encodeURIComponent(result.healthId));
  } catch(err){
    if(err instanceof AppError){req.flash('errors',[{message:err.message}]);req.flash('formData',req.body);return res.redirect('/agent/patients/new');}
    next(err);
  }
}

async function opdForm(req,res,next){
  try {
    const bid=branchId(req);
    const context=await agentService.getBookingContext(bid);
    const referralProviders=await agentService.getReferralProviders();
    const patient=req.query.healthId?await agentService.getPatient(req.query.healthId,bid):null;
    res.render('agent/opd-book',{title:'Book OPD — Agent Portal',...context,patient,agentBranchId:bid,referralProviders,today:new Date().toISOString().slice(0,10),selectedReferralCode:agentService.referralCode(req.query.referralCode,req.user.id)});
  }catch(err){next(err);}
}

async function searchPatients(req,res,next){
  try {
    const bid=branchId(req);
    const results=await agentService.searchPatientsForAgent(req.query.q,bid);
    res.json({results});
  } catch(err) { next(err); }
}

async function bookOpd(req,res,next){
  try {
    if (!req.body.healthId || !req.body.doctorId || !req.body.departmentId || !req.body.appointmentDate || !req.body.slotTime || !req.body.referralCode) {
      throw new AppError('Health ID, referral selection, department, doctor, date and slot time are required.',422);
    }
    const bid=branchId(req);
    const patient=await agentService.getPatient(req.body.healthId,bid);
    if(!patient) throw new AppError('Patient not found in this branch. Search by Health ID and select a valid patient.',404);

    // Existing patient attribution is immutable. Only patients without a
    // registered referral code can choose No referral or a new active code.
    let resolvedReferralCode = null;
    if (patient.referral_code) {
      resolvedReferralCode = (await agentService.resolveReferralForPatient(patient, patient.referral_code)).referral_code;
    } else if (req.body.referralCode !== 'NO_REFERRAL') {
      resolvedReferralCode = (await agentService.resolveReferralForPatient(patient, req.body.referralCode)).referral_code;
    }

    const result=await opdService.bookAppointment({
      patientId:patient.id,
      doctorId:req.body.doctorId,
      branchId:bid,
      departmentId:req.body.departmentId,
      appointmentDate:req.body.appointmentDate,
      slotTime:req.body.slotTime,
      reason:req.body.reason,
      lmpDate:req.body.lmpDate,
      gravida:req.body.gravida,
      para:req.body.para,
      abortions:req.body.abortions,
      pregnancyStatus: req.body.pregnancyStatus,
        pregnancyDatingMethod: req.body.pregnancyDatingMethod,
        conceptionDate: req.body.conceptionDate,
        referenceDate: req.body.referenceDate,
        usgDate: req.body.usgDate,
        usgGestationalAgeWeeks: req.body.usgGestationalAgeWeeks,
        usgGestationalAgeDays: req.body.usgGestationalAgeDays,
        usgEdd: req.body.usgEdd,
        obstetricNotes: req.body.obstetricNotes,
      referralCode: resolvedReferralCode
    },req.user.id);
    req.flash('success',`OPD booked for ${patient.name}. Token ${String(result.token).padStart(3,'0')} — ${result.appointmentCode}`);
    res.redirect('/agent/patients');
  }catch(err){
    if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/agent/opd/new'+(req.body.healthId?'?healthId='+encodeURIComponent(req.body.healthId):''));}
    next(err);
  }
}

async function testForm(req,res,next){
  try {
    const bid=branchId(req);
    const patient=req.query.healthId?await agentService.getPatient(req.query.healthId,bid):null;
    const referralProviders=await agentService.getReferralProviders();
    const tests=await agentService.getTestContext(bid);
    res.render('agent/test-book',{title:'Book Diagnostic Tests — Agent Portal',patient,tests,referralProviders,today:new Date().toISOString().slice(0,10),selectedReferralCode:agentService.referralCode(req.query.referralCode,req.user.id)});
  }catch(err){next(err);}
}

async function bookTest(req,res,next){
  try {
    if (!req.body.healthId || !req.body.referralCode) {
      throw new AppError('Health ID and referral number are required.',422);
    }
    const bid=branchId(req);
    const patient=await agentService.getPatient(req.body.healthId,bid);
    if(!patient) throw new AppError('Patient not found in this branch. Search by Health ID.',404);
    const testIds=Array.isArray(req.body.testIds)?req.body.testIds:(req.body.testIds?[req.body.testIds]:[]);
    const labService=require('../services/labService');
    const result=await labService.createOrder(patient.id,bid,req.user.id,{
      testIds,
      source:'AGENT',
      bookingDate:req.body.bookingDate,
      priority:req.body.priority||'ROUTINE',
      clinicalNotes:req.body.clinicalNotes,
      referralCode:(await agentService.resolveReferralForPatient(patient,req.body.referralCode)).referral_code
    });
    req.flash('success',`Diagnostic booking ${result.orderCode} created for ${patient.name}.`);
    res.redirect('/agent/patients');
  }catch(err){
    if(err instanceof AppError){req.flash('errors',[{message:err.message}]);return res.redirect('/agent/tests/new'+(req.body.healthId?'?healthId='+encodeURIComponent(req.body.healthId):''));}
    next(err);
  }
}

async function referrals(req,res,next){
  try {
    const rows=await agentService.referralStats(branchId(req));
    res.render('agent/referrals',{title:'Referral Tracking',rows});
  }catch(err){next(err);}
}

module.exports={dashboard,patients,newPatient,createPatient,opdForm,searchPatients,bookOpd,testForm,bookTest,referrals};
