const doctorService = require('../services/doctorService');
const scheduleService = require('../services/scheduleService');
const emailService = require('../services/emailService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');

async function list(req, res, next) {
  try {
    const doctors = await doctorService.listDoctors({ includeInactive: true });
    res.render('doctors/list', { title: 'Doctors', doctors });
  } catch (err) {
    next(err);
  }
}

async function showNewForm(req, res, next) {
  try {
    const [branches] = await pool.execute('SELECT id, name FROM branches WHERE is_active = 1');
    const [departments] = await pool.execute('SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name');
    res.render('doctors/new', { title: 'Add Doctor', branches, departments });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const result = await doctorService.createDoctor(req.body, req.user.id);
    req.flash('success', `Doctor created with ID ${result.doctorCode}. They must change their temporary password on first login.`);

    emailService
      .notifyAccountCreated({
        to: req.body.email,
        name: req.body.name,
        email: req.body.email,
        temporaryPassword: req.body.temporaryPassword,
        roleLabel: 'a doctor'
      })
      .catch(() => {});

    res.redirect(`/doctors/${result.id}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      req.flash('formData', req.body);
      return res.redirect('/doctors/new');
    }
    next(err);
  }
}

async function view(req, res, next) {
  try {
    const data = await doctorService.getDoctor(req.params.id);
    if (!data) throw new AppError('Doctor not found', 404);
    const [departments] = await pool.execute('SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name');

    const [opdHistory] = await pool.execute(
      `SELECT v.checked_in_at, v.status, p.health_id, p.name AS patient_name,
              a.referral_code, rp.provider_name AS referral_provider_name, c.diagnosis
       FROM opd_visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN appointments a ON a.id = v.appointment_id
       LEFT JOIN referral_providers rp ON rp.id = a.referral_provider_id
       LEFT JOIN opd_consultations c ON c.visit_id = v.id
       WHERE v.doctor_id = :id
       ORDER BY v.checked_in_at DESC LIMIT 50`,
      { id: req.params.id }
    );

    res.render('doctors/view', {
      title: `Doctor — ${data.doctor.name}`,
      ...data,
      departments,
      opdHistory
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    await doctorService.updateDoctor(req.params.id, req.body, req.user.id);
    req.flash('success', 'Doctor record updated.');
    res.redirect(`/doctors/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function addSchedule(req, res, next) {
  try {
    await doctorService.addScheduleTemplate(req.params.id, req.body, req.user.id);
    req.flash('success', 'Schedule added.');
    res.redirect(`/doctors/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function removeSchedule(req, res, next) {
  try {
    await doctorService.deleteScheduleTemplate(req.params.id, req.params.templateId, req.user.id);
    req.flash('success', 'Schedule removed.');
    res.redirect(`/doctors/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function addException(req, res, next) {
  try {
    await doctorService.addScheduleException(req.params.id, req.body, req.user.id);
    req.flash('success', 'Schedule exception saved.');
    res.redirect(`/doctors/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function assertAgentDoctorBranch(req) {
  if (!req.user || !Array.isArray(req.user.roles) || !req.user.roles.includes('AGENT')) return;
  const branchId = req.user.branch_id;
  if (!branchId) throw new AppError('Agent account has no branch assigned', 403);
  const [[doctor]] = await pool.execute(
    'SELECT id FROM doctors WHERE id=:doctorId AND branch_id=:branchId AND is_active=1 AND deleted_at IS NULL LIMIT 1',
    { doctorId: req.params.id, branchId }
  );
  if (!doctor) throw new AppError('Doctor not found for your branch', 404);
}

/** JSON endpoint used by the booking screen to fetch live slot availability. */
async function availableSlots(req, res, next) {
  try {
    await assertAgentDoctorBranch(req);
    const slots = await scheduleService.getAvailableSlots(req.params.id, req.query.date);
    res.json({ slots });
  } catch (err) {
    next(err);
  }
}

async function availableDates(req, res, next) {
  try {
    await assertAgentDoctorBranch(req);
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const dates = await scheduleService.getAvailableDates(req.params.id, from, req.query.days || 90);
    res.json({ dates });
  } catch (err) {
    next(err);
  }
}

/** JSON endpoint: doctors filtered by department/branch, for booking form cascade. */
async function doctorsByFilter(req, res, next) {
  try {
    const isAgent = Array.isArray(req.user.roles) && req.user.roles.includes('AGENT');
    const branchId = isAgent ? req.user.branch_id : (req.query.branchId || null);
    if (isAgent && !branchId) throw new AppError('Agent account has no branch assigned', 403);
    const doctors = await doctorService.listDoctors({
      branchId,
      departmentId: req.query.departmentId || null
    });
    res.json({ doctors });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  showNewForm,
  create,
  view,
  update,
  addSchedule,
  removeSchedule,
  addException,
  availableSlots,
  availableDates,
  doctorsByFilter
};
