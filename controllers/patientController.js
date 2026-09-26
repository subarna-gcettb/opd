const patientService = require('../services/patientService');
const patientPortalService = require('../services/patientPortalService');
const emailService = require('../services/emailService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');
const barcodeService = require('../services/barcodeService');

async function showNewForm(req, res, next) {
  try {
    const [branches] = await pool.execute('SELECT id, code, name FROM branches WHERE is_active = 1');
    res.render('patients/new', { title: 'New Patient Registration', branches, prefillMobile: req.query.mobile || '' });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const result = await patientService.registerPatient(req.body, req.user.id);
    req.flash('success', `Patient registered. Health ID: ${result.healthId}`);

    // If an email was captured at registration, automatically set up a
    // patient portal account using the fixed-pattern default password
    // (see patientPortalService.generateDefaultPassword) and email the
    // credentials — the patient must change it on first login.
    if (req.body.email) {
      createPortalAccountSilently(result, req.body.email, req.user.id).catch((err) => {
        console.error('[patient portal] auto-creation failed:', err.message);
      });
    }

    res.redirect(`/patients/${result.healthId}?justRegistered=1`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      req.flash('formData', req.body);
      return res.redirect('/patients/new');
    }
    next(err);
  }
}

async function createPortalAccountSilently(registrationResult, email, actorUserId) {
  const account = await patientPortalService.createPortalAccount(
    registrationResult.id,
    { email },
    actorUserId
  );
  await emailService.notifyAccountCreated({
    to: account.email,
    name: account.patientName,
    email: account.email,
    temporaryPassword: account.temporaryPassword,
    roleLabel: 'a patient'
  });
}

function showSearch(req, res) {
  res.render('patients/search', { title: 'Patient Search' });
}

async function searchResults(req, res, next) {
  try {
    const results = await patientService.searchPatients({ q: req.query.q });
    if ((req.headers.accept || '').includes('application/json') || req.xhr) {
      return res.json({ results });
    }
    res.render('patients/search', { title: 'Patient Search', results, q: req.query.q });
  } catch (err) {
    if ((req.headers.accept || '').includes('application/json') || req.xhr) {
      return res.status(err.statusCode || 500).json({ results: [], error: err.message || 'Patient search failed' });
    }
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const data = await patientService.listPatients({ page, pageSize: 20 });
    res.render('patients/list', { title: 'All Patients', ...data, totalPages: Math.ceil(data.total / data.pageSize) });
  } catch (err) {
    next(err);
  }
}

async function profile(req, res, next) {
  try {
    const data = await patientService.getPatientProfile(req.params.healthId);
    if (!data) throw new AppError('Patient not found', 404);
    res.render('patients/profile', {
      title: `Patient — ${data.patient.name}`,
      ...data,
      justRegistered: req.query.justRegistered === '1'
    });
  } catch (err) {
    next(err);
  }
}

async function barcodeImage(req, res, next) {
  try {
    const png = await barcodeService.generateCode128(req.params.healthId);
    res.set('Content-Type', 'image/png');
    // Authenticated route only (requireAuth already applied) — never a public URL.
    res.send(png);
  } catch (err) {
    next(err);
  }
}

async function registrationSlip(req, res, next) {
  try {
    const data = await patientService.getPatientProfile(req.params.healthId);
    if (!data) throw new AppError('Patient not found', 404);
    res.render('print/registration-slip', {
      layout: 'layouts/blank',
      title: 'Registration Slip',
      patient: data.patient
    });
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const data = await patientService.getPatientProfile(req.params.healthId);
    if (!data) throw new AppError('Patient not found', 404);
    res.render('patients/edit', { title: `Edit — ${data.patient.name}`, patient: data.patient });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const data = await patientService.getPatientProfile(req.params.healthId);
    if (!data) throw new AppError('Patient not found', 404);
    await patientService.updatePatient(data.patient.id, req.body, req.user.id);
    req.flash('success', 'Patient details updated.');
    res.redirect(`/patients/${req.params.healthId}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      req.flash('formData', req.body);
      return res.redirect(`/patients/${req.params.healthId}/edit`);
    }
    next(err);
  }
}

async function suspend(req, res, next) {
  try {
    const data = await patientService.getPatientProfile(req.params.healthId);
    if (!data) throw new AppError('Patient not found', 404);
    await patientService.suspendPatient(data.patient.id, req.user.id, req.body.reason);
    req.flash('success', `Patient ${data.patient.name} has been suspended. Medical history is retained.`);
    res.redirect(`/patients/${req.params.healthId}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/patients/${req.params.healthId}`);
    }
    next(err);
  }
}

async function restore(req, res, next) {
  try {
    const data = await patientService.getPatientProfile(req.params.healthId);
    if (!data) throw new AppError('Patient not found', 404);
    await patientService.restorePatient(data.patient.id, req.user.id);
    req.flash('success', 'Patient has been restored to active status.');
    res.redirect(`/patients/${req.params.healthId}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/patients/${req.params.healthId}`);
    }
    next(err);
  }
}

module.exports = {
  showNewForm,
  create,
  showSearch,
  searchResults,
  list,
  profile,
  barcodeImage,
  registrationSlip,
  showEditForm,
  update
  ,suspend
  ,restore
};
