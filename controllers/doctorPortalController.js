const consultationService = require('../services/consultationService');
const opdService = require('../services/opdService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');
const prescriptionService = require('../services/prescriptionService');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Resolves the doctor context for the logged-in user. */
function requireDoctorContext(req) {
  if (!req.user.doctorId && !req.user.roles.includes('SUPER_ADMIN')) {
    throw new AppError('This area is only available to doctors', 403);
  }
  return req.user.doctorId;
}

async function dashboard(req, res, next) {
  try {
    const doctorId = requireDoctorContext(req);
    const date = req.query.date || todayStr();

    const stats = doctorId
      ? await consultationService.getDoctorDashboard(doctorId, date)
      : { totalToday: 0, waiting: 0, called: 0, inConsultation: 0, completed: 0, upcoming: 0 };

    const queue = await opdService.getQueue({ date, doctorId });

    const [upcoming] = await pool.execute(
      `SELECT a.id, a.appointment_date, a.slot_time, a.token_number,
              p.health_id, p.name AS patient_name, p.age_years, p.gender
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.doctor_id = :doctorId AND a.appointment_date > :date
         AND a.status IN ('BOOKED','RESCHEDULED')
       ORDER BY a.appointment_date, a.slot_time LIMIT 15`,
      { doctorId, date }
    );

    res.render('doctors/portal-dashboard', {
      title: 'Doctor Portal',
      stats,
      queue,
      upcoming,
      date
    });
  } catch (err) {
    next(err);
  }
}

async function queue(req, res, next) {
  try {
    const doctorId = requireDoctorContext(req);
    const date = req.query.date || todayStr();
    const rows = await opdService.getQueue({ date, doctorId });
    const stats = doctorId
      ? await consultationService.getDoctorDashboard(doctorId, date)
      : { totalToday: 0, waiting: 0, called: 0, inConsultation: 0, completed: 0, upcoming: 0 };
    res.render('doctors/portal-queue', { title: 'My Patients Today', rows, date, stats });
  } catch (err) {
    next(err);
  }
}

/** Calls the next waiting patient in token order. */
async function callNext(req, res, next) {
  try {
    const doctorId = requireDoctorContext(req);
    const date = todayStr();
    const rows = await opdService.getQueue({ date, doctorId });
    const nextPatient = rows.find((r) => r.visit_status === 'WAITING');
    if (!nextPatient) {
      req.flash('errors', [{ message: 'No patients are waiting.' }]);
      return res.redirect('/doctor/queue');
    }
    await opdService.updateVisitStatus(nextPatient.visit_id, 'CALLED', req.user.id);
    req.flash('success', `Called token ${String(nextPatient.token_number).padStart(3, '0')} — ${nextPatient.patient_name}.`);
    res.redirect('/doctor/queue');
  } catch (err) {
    next(err);
  }
}

async function consultation(req, res, next) {
  try {
    requireDoctorContext(req);
    await consultationService.assertDoctorCanAccessVisit(req.params.visitId, req.user);

    const context = await consultationService.getConsultationContext(req.params.visitId);
    if (!context) throw new AppError('Visit not found', 404);

    const [medicines] = await pool.execute(
      'SELECT id, name, strength, composition, form FROM medicines WHERE is_active = 1 ORDER BY name LIMIT 500'
    );
    const [formOptions] = await pool.execute(
      "SELECT value FROM prescription_option_values WHERE option_type = 'FORM' ORDER BY value"
    );
    const [routeOptions] = await pool.execute(
      "SELECT value FROM prescription_option_values WHERE option_type = 'ROUTE' ORDER BY value"
    );

    res.render('doctors/consultation', {
      title: `Consultation — ${context.visit.patient_name}`,
      ...context,
      medicines,
      formOptions: formOptions.map(x => x.value),
      routeOptions: routeOptions.map(x => x.value)
    });
  } catch (err) {
    next(err);
  }
}

async function saveConsultation(req, res, next) {
  try {
    requireDoctorContext(req);
    await consultationService.assertDoctorCanAccessVisit(req.params.visitId, req.user);
    const items = prescriptionService.itemsFromBody(req.body);
    if (!items.length) throw new AppError('Add at least one medicine to save the consultation and prescription.', 422);
    const result = await consultationService.saveConsultation(req.params.visitId, req.body, req.user.id, items);
    req.flash('success', `Consultation and prescription ${result.prescription.code} (v${result.prescription.version}) saved together.`);
    res.redirect(`/doctor/consultation/${req.params.visitId}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/doctor/consultation/${req.params.visitId}`);
    }
    next(err);
  }
}

async function completeVisit(req, res, next) {
  try {
    requireDoctorContext(req);
    await consultationService.assertDoctorCanAccessVisit(req.params.visitId, req.user);
    await opdService.updateVisitStatus(req.params.visitId, 'COMPLETED', req.user.id);
    req.flash('success', 'Consultation completed. The clinical record is now finalized.');
    const [[invoice]] = await pool.execute('SELECT id, status FROM invoices WHERE visit_id = :visitId ORDER BY created_at DESC LIMIT 1', { visitId: req.params.visitId });
    res.redirect(invoice && invoice.status !== 'PAID' ? '/billing/invoices/' + invoice.id : '/doctor/queue');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/doctor/consultation/${req.params.visitId}`);
    }
    next(err);
  }
}

async function profile(req, res, next) {
  try {
    const doctorId = requireDoctorContext(req);
    const doctorService = require('../services/doctorService');
    const doctor = await doctorService.getOwnProfile(doctorId);
    if (!doctor) throw new AppError('Doctor profile not found', 404);
    res.render('doctors/portal-profile', { title: 'My Profile', doctor });
  } catch (err) { next(err); }
}

async function updateProfile(req, res, next) {
  try {
    const doctorId = requireDoctorContext(req);
    const doctorService = require('../services/doctorService');
    await doctorService.updateOwnProfile(doctorId, req.user.id, req.body);
    req.flash('success', 'Your doctor profile has been updated.');
    res.redirect('/doctor/profile');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/doctor/profile');
    }
    next(err);
  }
}


async function saveComplaintSuggestion(req, res, next) {
  try {
    const doctorId = requireDoctorContext(req);
    const complaint = String(req.body.complaint || '').trim().replace(/\s+/g, ' ');
    if (!doctorId) throw new AppError('A doctor account is required', 403);
    if (!complaint || complaint.length < 2) return res.status(422).json({ ok: false, message: 'Complaint is too short.' });
    if (complaint.length > 255) return res.status(422).json({ ok: false, message: 'Complaint is too long.' });

    await pool.execute(
      `INSERT INTO doctor_complaint_suggestions (doctor_id, complaint, normalized)
       VALUES (:doctorId, :complaint, :normalized)
       ON DUPLICATE KEY UPDATE complaint = VALUES(complaint), updated_at = NOW()`,
      { doctorId, complaint, normalized: complaint.toLowerCase() }
    );
    res.json({ ok: true, complaint });
  } catch (err) {
    next(err);
  }
}

module.exports = { dashboard, queue, callNext, consultation, saveConsultation, completeVisit, profile, updateProfile, saveComplaintSuggestion };
