const prescriptionService = require('../services/prescriptionService');
const consultationService = require('../services/consultationService');
const barcodeService = require('../services/barcodeService');
const emailService = require('../services/emailService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');

async function create(req, res, next) {
  try {
    const visitId = req.body.visitId;
    await consultationService.assertDoctorCanAccessVisit(visitId, req.user);
    const items = prescriptionService.itemsFromBody(req.body);
    const result = await prescriptionService.createPrescription(visitId, items, req.user.id);
    req.flash('success', `Prescription ${result.code} created.`);

    notifyPrescriptionCreated(result.id).catch(() => {});

    res.redirect(`/prescriptions/${result.id}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/doctor/consultation/${req.body.visitId}`);
    }
    next(err);
  }
}

async function notifyPrescriptionCreated(prescriptionId) {
  const data = await prescriptionService.getPrescription(prescriptionId);
  if (!data) return;
  const [[row]] = await pool.execute('SELECT email FROM patients WHERE id = :id', {
    id: data.prescription.patient_id
  });
  if (!row || !row.email) return;
  await emailService.notifyPrescriptionCreated({
    to: row.email,
    patientName: data.prescription.patient_name,
    healthId: data.prescription.health_id,
    doctorName: data.prescription.doctor_name,
    prescriptionCode: data.prescription.prescription_code
  });
}

async function view(req, res, next) {
  try {
    const data = await prescriptionService.getPrescription(req.params.id);
    if (!data) throw new AppError('Prescription not found', 404);

    const [medicines] = await pool.execute(
      'SELECT id, name, strength, form FROM medicines WHERE is_active = 1 ORDER BY name LIMIT 500'
    );

    const canAmend =
      req.user.roles.includes('SUPER_ADMIN') ||
      (req.user.doctorId && data.prescription.doctor_id === req.user.doctorId);

    res.render('prescriptions/view', {
      title: `Prescription ${data.prescription.prescription_code}`,
      ...data,
      medicines,
      canAmend: canAmend && data.prescription.is_current
    });
  } catch (err) {
    next(err);
  }
}

async function amend(req, res, next) {
  try {
    await prescriptionService.assertCanAmend(req.params.id, req.user);
    const items = prescriptionService.itemsFromBody(req.body);
    const result = await prescriptionService.amendPrescription(
      req.params.id,
      items,
      req.body.amendmentReason,
      req.user.id
    );
    req.flash('success', `Prescription amended — version ${result.version} is now current. The previous version has been retained.`);
    res.redirect(`/prescriptions/${result.id}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/prescriptions/${req.params.id}`);
    }
    next(err);
  }
}

async function print(req, res, next) {
  try {
    const data = await prescriptionService.getPrescription(req.params.id);
    if (!data) throw new AppError('Prescription not found', 404);

    // Barcode encodes ONLY the Health ID.
    const barcodeDataUri = await barcodeService.generateCode128DataUri(data.prescription.barcode_value);

    res.render('print/prescription', {
      layout: 'layouts/blank',
      title: 'Prescription',
      ...data,
      barcodeDataUri
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Barcode scan resolution. An authorized staff member scans a prescription
 * barcode (which contains the Health ID) and is taken to the patient
 * profile. Authentication and authorization are enforced by the route
 * middleware — there is no public lookup path.
 */
async function scanLookup(req, res, next) {
  try {
    const healthId = (req.query.code || '').trim();
    if (!healthId) {
      req.flash('errors', [{ message: 'No barcode value supplied.' }]);
      return res.redirect('/patients/search');
    }
    const [[patient]] = await pool.execute(
      'SELECT health_id FROM patients WHERE health_id = :healthId AND deleted_at IS NULL LIMIT 1',
      { healthId }
    );
    if (!patient) {
      req.flash('errors', [{ message: 'No patient matches that barcode.' }]);
      return res.redirect('/patients/search');
    }
    res.redirect(`/patients/${patient.health_id}`);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, view, amend, print, scanLookup };
