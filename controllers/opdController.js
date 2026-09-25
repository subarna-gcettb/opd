const opdService = require('../services/opdService');
const patientService = require('../services/patientService');
const liveOpdService = require('../services/liveOpdService');
const emailService = require('../services/emailService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function showBookingForm(req, res, next) {
  try {
    const [branches] = await pool.execute('SELECT id, name FROM branches WHERE is_active = 1');
    const [departments] = await pool.execute('SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name');

    let patient = null;
    if (req.query.healthId) {
      const data = await patientService.getPatientProfile(req.query.healthId);
      if (data) patient = data.patient;
    }

    res.render('opd/book', {
      title: 'Book OPD Appointment',
      branches,
      departments,
      patient,
      today: todayStr()
    });
  } catch (err) {
    next(err);
  }
}

async function book(req, res, next) {
  try {
    const result = await opdService.bookAppointment(
      {
        patientId: req.body.patientId,
        doctorId: req.body.doctorId,
        branchId: req.body.branchId,
        departmentId: req.body.departmentId,
        appointmentDate: req.body.appointmentDate,
        slotTime: req.body.slotTime,
        reason: req.body.reason
      },
      req.user.id
    );
    req.flash('success', `Appointment booked. Token ${String(result.token).padStart(3, '0')} — ${result.appointmentCode}`);

    // Best-effort notification — never blocks or fails the booking itself.
    notifyBooked(req.body.patientId, req.body.doctorId, req.body.departmentId, req.body.appointmentDate, req.body.slotTime, result).catch(() => {});

    res.redirect(`/opd/appointments/${result.appointmentId}?booked=1`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      req.flash('formData', req.body);
      return res.redirect(`/opd/appointments/new${req.body.healthId ? '?healthId=' + req.body.healthId : ''}`);
    }
    next(err);
  }
}

async function notifyBooked(patientId, doctorId, departmentId, appointmentDate, slotTime, result) {
  const [[row]] = await pool.execute(
    `SELECT p.name AS patient_name, p.email, p.health_id, u.name AS doctor_name, dept.name AS department_name
     FROM patients p, doctors d JOIN users u ON u.id = d.user_id
     JOIN departments dept ON dept.id = :departmentId
     WHERE p.id = :patientId AND d.id = :doctorId`,
    { patientId, doctorId, departmentId }
  );
  if (!row || !row.email) return;
  await emailService.notifyAppointmentBooked({
    to: row.email,
    patientName: row.patient_name,
    healthId: row.health_id,
    doctorName: row.doctor_name,
    department: row.department_name,
    date: appointmentDate,
    time: slotTime,
    token: result.token,
    appointmentCode: result.appointmentCode
  });
}

async function listAppointments(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filters = {
      date: req.query.date || null,
      doctorId: req.query.doctorId || null,
      status: req.query.status || null,
      page,
      pageSize: 25
    };
    const data = await opdService.listAppointments(filters);
    const [doctors] = await pool.execute(
      `SELECT d.id, u.name FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE d.deleted_at IS NULL AND d.is_active = 1 ORDER BY u.name`
    );
    res.render('opd/appointments', {
      title: 'Appointments',
      ...data,
      doctors,
      filters,
      totalPages: Math.ceil(data.total / data.pageSize)
    });
  } catch (err) {
    next(err);
  }
}

async function viewAppointment(req, res, next) {
  try {
    const data = await opdService.getAppointment(req.params.id);
    if (!data) throw new AppError('Appointment not found', 404);
    res.render('opd/appointment-detail', {
      title: `Appointment ${data.appointment.appointment_code}`,
      ...data,
      justBooked: req.query.booked === '1'
    });
  } catch (err) {
    next(err);
  }
}

async function reschedule(req, res, next) {
  try {
    const result = await opdService.rescheduleAppointment(
      req.params.id,
      { newDate: req.body.newDate, newTime: req.body.newTime, reason: req.body.reason },
      req.user.id
    );
    req.flash('success', 'Appointment rescheduled. The original date has been preserved in the appointment history.');

    notifyRescheduled(req.params.id, req.body, result).catch(() => {});

    res.redirect(`/opd/appointments/${req.params.id}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/opd/appointments/${req.params.id}`);
    }
    next(err);
  }
}

async function notifyRescheduled(appointmentId, body, result) {
  const data = await opdService.getAppointment(appointmentId);
  if (!data || !data.appointment.patient_email) return;
  const { appointment } = data;
  await emailService.notifyAppointmentRescheduled({
    to: appointment.patient_email,
    patientName: appointment.patient_name,
    healthId: appointment.health_id,
    doctorName: appointment.doctor_name,
    oldDate: '(previous)',
    oldTime: '',
    newDate: body.newDate,
    newTime: body.newTime,
    newToken: result.newToken,
    reason: body.reason
  });
}

async function cancel(req, res, next) {
  try {
    await opdService.cancelAppointment(req.params.id, req.body.reason, req.user.id);
    req.flash('success', 'Appointment cancelled.');

    notifyCancelled(req.params.id, req.body.reason).catch(() => {});

    res.redirect(`/opd/appointments/${req.params.id}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/opd/appointments/${req.params.id}`);
    }
    next(err);
  }
}

async function notifyCancelled(appointmentId, reason) {
  const data = await opdService.getAppointment(appointmentId);
  if (!data || !data.appointment.patient_email) return;
  const { appointment } = data;
  await emailService.notifyAppointmentCancelled({
    to: appointment.patient_email,
    patientName: appointment.patient_name,
    healthId: appointment.health_id,
    doctorName: appointment.doctor_name,
    date: new Date(appointment.appointment_date).toLocaleDateString(),
    time: String(appointment.slot_time).slice(0, 5),
    reason
  });
}

async function noShow(req, res, next) {
  try {
    await opdService.markNoShow(req.params.id, req.user.id);
    req.flash('success', 'Marked as no-show.');
    res.redirect(`/opd/appointments/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function queue(req, res, next) {
  try {
    const date = req.query.date || todayStr();
    const doctorId = req.query.doctorId || null;
    const rows = await opdService.getQueue({ date, doctorId });
    const [doctors] = await pool.execute(
      `SELECT d.id, u.name FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE d.deleted_at IS NULL AND d.is_active = 1 ORDER BY u.name`
    );
    res.render('opd/queue', { title: "Today's OPD Queue", rows, doctors, date, doctorId });
  } catch (err) {
    next(err);
  }
}

async function updateVisitStatus(req, res, next) {
  try {
    await opdService.updateVisitStatus(req.params.visitId, req.body.status, req.user.id);
    req.flash('success', `Patient status updated to ${req.body.status.replace('_', ' ').toLowerCase()}.`);
    res.redirect(req.get('Referer') || '/opd/queue');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(req.get('Referer') || '/opd/queue');
    }
    next(err);
  }
}

async function printToken(req, res, next) {
  try {
    const data = await opdService.getAppointment(req.params.id);
    if (!data) throw new AppError('Appointment not found', 404);
    res.render('print/token', {
      layout: 'layouts/blank',
      title: 'OPD Token',
      appointment: data.appointment
    });
  } catch (err) {
    next(err);
  }
}

async function appointmentBarcode(req, res, next) {
  try {
    const data = await opdService.getAppointment(req.params.id);
    if (!data) throw new AppError('Appointment not found', 404);
    const barcodeService = require('../services/barcodeService');
    const png = await barcodeService.generateCode128(data.appointment.appointment_code);
    res.set('Content-Type', 'image/png').send(png);
  } catch (err) { next(err); }
}

async function liveBoard(req, res, next) {
  try {
    const date = req.query.date || liveOpdService.todayStr();
    const doctors = await liveOpdService.getStaffBoard(date);
    res.render('opd/live-board', { title: 'Live OPD Board', doctors, date });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  showBookingForm,
  book,
  listAppointments,
  viewAppointment,
  reschedule,
  cancel,
  noShow,
  queue,
  updateVisitStatus,
  printToken,
  liveBoard
};
