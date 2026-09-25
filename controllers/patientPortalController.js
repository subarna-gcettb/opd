const patientPortalService = require('../services/patientPortalService');
const prescriptionService = require('../services/prescriptionService');
const billingService = require('../services/billingService');
const emailService = require('../services/emailService');
const barcodeService = require('../services/barcodeService');
const opdService = require('../services/opdService');
const doctorService = require('../services/doctorService');
const scheduleService = require('../services/scheduleService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');

function requirePatientContext(req) {
  if (!req.user.patientId) {
    throw new AppError('This area is only available to patient portal accounts', 403);
  }
  return req.user.patientId;
}

async function dashboard(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await patientPortalService.getOwnDashboard(patientId);
    res.render('patient-portal/dashboard', { title: 'My Health Record', ...data });
  } catch (err) {
    next(err);
  }
}

/** Own Health ID barcode — scoped to the logged-in patient, no patient.view permission required. */
async function ownBarcode(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await patientPortalService.getOwnDashboard(patientId);
    const png = await barcodeService.generateCode128(data.patient.health_id);
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    next(err);
  }
}

/** A patient may only open a prescription that is actually theirs. */
async function viewPrescription(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await prescriptionService.getPrescription(req.params.id);
    if (!data || data.prescription.patient_id !== patientId) {
      throw new AppError('Prescription not found', 404);
    }
    // Dedicated lightweight view — deliberately NOT the staff prescriptions/view.ejs,
    // whose "Print"/"Amend" controls point at staff-only routes.
    res.render('patient-portal/prescription', { title: `Prescription ${data.prescription.prescription_code}`, ...data });
  } catch (err) {
    next(err);
  }
}

async function printPrescription(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await prescriptionService.getPrescription(req.params.id);
    if (!data || data.prescription.patient_id !== patientId) {
      throw new AppError('Prescription not found', 404);
    }
    const barcodeDataUri = await barcodeService.generateCode128DataUri(data.prescription.barcode_value);
    res.render('print/prescription', { layout: 'layouts/blank', title: 'Prescription', ...data, barcodeDataUri });
  } catch (err) {
    next(err);
  }
}

/** A patient may only open an invoice that is actually theirs. */
async function viewInvoice(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await billingService.getInvoice(req.params.id);
    if (!data || data.invoice.patient_id !== patientId) {
      throw new AppError('Invoice not found', 404);
    }
    res.render('patient-portal/invoice', { title: `Invoice ${data.invoice.invoice_number}`, ...data });
  } catch (err) {
    next(err);
  }
}

async function printReceipt(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await billingService.getInvoice(req.params.id);
    if (!data || data.invoice.patient_id !== patientId) throw new AppError('Invoice not found', 404);
    const payment = data.payments.find((p) => p.id === Number(req.params.paymentId));
    if (!payment) throw new AppError('Payment not found', 404);
    res.render('print/receipt', { layout: 'layouts/blank', title: 'Receipt', ...data, payment });
  } catch (err) {
    next(err);
  }
}

// ---- Staff-side: create a portal account from a patient's profile ----
async function createAccount(req, res, next) {
  try {
    const result = await patientPortalService.createPortalAccount(req.params.patientId, req.body, req.user.id);
    req.flash(
      'success',
      `Portal account created for ${result.patientName}. Temporary password: ${result.temporaryPassword} (also emailed if SMTP is configured).`
    );
    emailService
      .notifyAccountCreated({
        to: result.email,
        name: result.patientName,
        email: result.email,
        temporaryPassword: result.temporaryPassword,
        roleLabel: 'a patient portal user'
      })
      .catch(() => {});
    res.redirect(`/patients/${req.body.healthId || ''}`.replace(/\/$/, '') || '/patients');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/patients/${req.body.healthId || ''}`);
    }
    next(err);
  }
}

// ---- Self-service booking ----------------------------------------------

async function showBookForm(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await patientPortalService.getOwnDashboard(patientId);
    const [departments] = await pool.execute('SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name');
    res.render('patient-portal/book', {
      title: 'Book an Appointment',
      patient: data.patient,
      departments,
      today: new Date().toISOString().slice(0, 10)
    });
  } catch (err) {
    next(err);
  }
}

/** JSON: doctors in a department, for the booking cascade — patient-portal scoped. */
async function doctorsByDepartment(req, res, next) {
  try {
    requirePatientContext(req);
    const doctors = await doctorService.listDoctors({ departmentId: req.query.departmentId || null });
    res.json({ doctors });
  } catch (err) {
    next(err);
  }
}

/** JSON: live slot availability for a doctor/date — patient-portal scoped. */
async function doctorSlots(req, res, next) {
  try {
    requirePatientContext(req);
    const slots = await scheduleService.getAvailableSlots(req.params.doctorId, req.query.date);
    res.json({ slots });
  } catch (err) {
    next(err);
  }
}

async function book(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const dashboardData = await patientPortalService.getOwnDashboard(patientId);

    const result = await opdService.bookAppointment(
      {
        // patientId ALWAYS comes from the session, never from the
        // request body — a patient can only ever book for themselves.
        patientId,
        doctorId: req.body.doctorId,
        branchId: dashboardData.patient.branch_id,
        departmentId: req.body.departmentId,
        appointmentDate: req.body.appointmentDate,
        slotTime: req.body.slotTime,
        reason: req.body.reason,
        lmpDate: req.body.lmpDate,
        gravida: req.body.gravida,
        para: req.body.para,
        abortions: req.body.abortions,
        pregnancyStatus: req.body.pregnancyStatus,
        obstetricNotes: req.body.obstetricNotes
      },
      req.user.id
    );

    req.flash('success', `Appointment booked. Token ${String(result.token).padStart(3, '0')} — ${result.appointmentCode}`);

    if (dashboardData.patient.email) {
      const [[doctorRow]] = await pool.execute(
        `SELECT u.name AS doctor_name, dept.name AS department_name
         FROM doctors d JOIN users u ON u.id = d.user_id JOIN departments dept ON dept.id = :deptId
         WHERE d.id = :doctorId`,
        { doctorId: req.body.doctorId, deptId: req.body.departmentId }
      );
      emailService
        .notifyAppointmentBooked({
          to: dashboardData.patient.email,
          patientName: dashboardData.patient.name,
          healthId: dashboardData.patient.health_id,
          doctorName: doctorRow ? doctorRow.doctor_name : '',
          department: doctorRow ? doctorRow.department_name : '',
          date: req.body.appointmentDate,
          time: req.body.slotTime,
          token: result.token,
          appointmentCode: result.appointmentCode
        })
        .catch(() => {});
    }

    res.redirect('/patient-portal?booked=1');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/patient-portal/book');
    }
    next(err);
  }
}

async function showEditProfile(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    const data = await patientPortalService.getOwnDashboard(patientId);
    res.render('patient-portal/edit-profile', { title: 'Edit My Profile', patient: data.patient });
  } catch (err) {
    next(err);
  }
}

async function updateOwnProfile(req, res, next) {
  try {
    const patientId = requirePatientContext(req);
    await patientPortalService.updateOwnProfile(patientId, req.body);
    req.flash('success', 'Profile updated.');
    res.redirect('/patient-portal');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/patient-portal/edit-profile');
    }
    next(err);
  }
}

module.exports = {
  dashboard,
  ownBarcode,
  viewPrescription,
  printPrescription,
  viewInvoice,
  printReceipt,
  createAccount,
  showBookForm,
  doctorsByDepartment,
  doctorSlots,
  book,
  showEditProfile,
  updateOwnProfile
};
