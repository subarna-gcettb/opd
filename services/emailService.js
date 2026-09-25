const nodemailer = require('nodemailer');
const emailConfig = require('../config/email');

let transporter = null;

function getTransporter() {
  if (!emailConfig.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: emailConfig.user ? { user: emailConfig.user, pass: emailConfig.password } : undefined
    });
  }
  return transporter;
}

/**
 * Sends one email. Never throws to the caller — logs and resolves on
 * any failure (missing SMTP config, network error, bad address, etc.)
 * so a notification failure can never break the request that triggered
 * it. Callers should still be able to `.catch()` this if they want to
 * know, but are not required to `await` it on the critical path.
 */
async function sendMail({ to, subject, html, text }) {
  if (!to) {
    console.warn(`[email] Skipped "${subject}" — no recipient address on file.`);
    return { sent: false, reason: 'no_recipient' };
  }
  const client = getTransporter();
  if (!client) {
    console.warn(`[email] SMTP not configured — skipped "${subject}" to ${to}.`);
    return { sent: false, reason: 'smtp_disabled' };
  }
  try {
    await client.sendMail({
      from: `"${emailConfig.fromName}" <${emailConfig.fromEmail}>`,
      to,
      subject,
      html,
      text: text || undefined
    });
    return { sent: true };
  } catch (err) {
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

/** Wraps templated content in a consistent, branded HTML shell. */
function layout(title, bodyHtml) {
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
    <div style="background:#0a3d3d;padding:18px 24px;border-radius:8px 8px 0 0;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.05em;">CHHAYABITHI</div>
      <div style="color:#9fd6cd;font-size:12px;">Hospital Management System</div>
    </div>
    <div style="border:1px solid #e2e8e8;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
      <h2 style="margin-top:0;color:#0d6e6e;font-size:16px;">${title}</h2>
      ${bodyHtml}
    </div>
    <div style="text-align:center;color:#8a96a3;font-size:11px;margin-top:14px;">
      This is an automated notification from Chhayabithi HMS. Please do not reply to this email.
    </div>
  </div>`;
}

function row(label, value) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#555;font-size:13px;">${label}</td><td style="padding:4px 0;font-size:13px;font-weight:600;">${value}</td></tr>`;
}

// ---------------------------------------------------------------- OPD

async function notifyAppointmentBooked({ to, patientName, healthId, doctorName, department, date, time, token, appointmentCode }) {
  const html = layout(
    'Appointment Confirmed',
    `<p>Dear ${patientName},</p><p>Your OPD appointment has been booked.</p>
     <table>${row('Health ID', healthId)}${row('Doctor', doctorName)}${row('Department', department)}
     ${row('Date', date)}${row('Time', time)}${row('Token', String(token).padStart(3, '0'))}
     ${row('Appointment No.', appointmentCode)}</table>
     <p>Please arrive a few minutes before your slot time and carry your Health ID.</p>`
  );
  return sendMail({ to, subject: `Appointment Confirmed — Token ${String(token).padStart(3, '0')}`, html });
}

async function notifyAppointmentRescheduled({ to, patientName, healthId, doctorName, oldDate, oldTime, newDate, newTime, newToken, reason }) {
  const html = layout(
    'Appointment Rescheduled',
    `<p>Dear ${patientName},</p><p>Your appointment with ${doctorName} has been rescheduled.</p>
     <table>${row('Health ID', healthId)}${row('Previous', `${oldDate} ${oldTime || ''}`)}
     ${row('New Date/Time', `${newDate} ${newTime}`)}${row('New Token', String(newToken).padStart(3, '0'))}
     ${row('Reason', reason || '—')}</table>`
  );
  return sendMail({ to, subject: 'Your OPD Appointment Has Been Rescheduled', html });
}

async function notifyAppointmentCancelled({ to, patientName, healthId, doctorName, date, time, reason }) {
  const html = layout(
    'Appointment Cancelled',
    `<p>Dear ${patientName},</p><p>Your appointment with ${doctorName} on ${date} ${time} has been cancelled.</p>
     <table>${row('Health ID', healthId)}${row('Reason', reason || '—')}</table>
     <p>Please contact the hospital to rebook if this was not expected.</p>`
  );
  return sendMail({ to, subject: 'Your OPD Appointment Has Been Cancelled', html });
}

// ---------------------------------------------------------- PRESCRIPTION

async function notifyPrescriptionCreated({ to, patientName, healthId, doctorName, prescriptionCode }) {
  const html = layout(
    'Prescription Issued',
    `<p>Dear ${patientName},</p><p>Dr. ${doctorName} has issued a new prescription for you.</p>
     <table>${row('Health ID', healthId)}${row('Prescription No.', prescriptionCode)}</table>
     <p>You can view or collect a printed copy at the hospital reception.</p>`
  );
  return sendMail({ to, subject: `Prescription ${prescriptionCode} Issued`, html });
}

// --------------------------------------------------------------- BILLING

async function notifyInvoiceCreated({ to, patientName, healthId, invoiceNumber, netAmount, doctorName }) {
  const html = layout(
    'Invoice Generated',
    `<p>Dear ${patientName},</p><p>An invoice has been generated for your consultation with ${doctorName}.</p>
     <table>${row('Health ID', healthId)}${row('Invoice No.', invoiceNumber)}${row('Amount Due', `₹${Number(netAmount).toFixed(2)}`)}</table>`
  );
  return sendMail({ to, subject: `Invoice ${invoiceNumber} Generated`, html });
}

async function notifyPaymentReceived({ to, patientName, healthId, invoiceNumber, amount, method, receiptNumber }) {
  const html = layout(
    'Payment Received',
    `<p>Dear ${patientName},</p><p>We have received your payment. Thank you.</p>
     <table>${row('Health ID', healthId)}${row('Invoice No.', invoiceNumber)}${row('Receipt No.', receiptNumber)}
     ${row('Amount Paid', `₹${Number(amount).toFixed(2)}`)}${row('Method', method)}</table>`
  );
  return sendMail({ to, subject: `Payment Received — Receipt ${receiptNumber}`, html });
}

async function notifyDiscountDecision({ to, recipientName, invoiceNumber, status, rejectionReason }) {
  const html = layout(
    `Discount Request ${status}`,
    `<p>Dear ${recipientName},</p><p>Your discount request on invoice ${invoiceNumber} has been <strong>${String(status).toLowerCase()}</strong>.</p>
     ${status === 'REJECTED' && rejectionReason ? `<table>${row('Reason', rejectionReason)}</table>` : ''}`
  );
  return sendMail({ to, subject: `Discount Request ${status} — Invoice ${invoiceNumber}`, html });
}

// ----------------------------------------------------------------- USERS

async function notifyAccountCreated({ to, name, email, temporaryPassword, roleLabel }) {
  const html = layout(
    'Account Created',
    `<p>Dear ${name},</p><p>An account has been created for you on Chhayabithi HMS${roleLabel ? ` as ${roleLabel}` : ''}.</p>
     <table>${row('Login Email', email)}${row('Temporary Password', temporaryPassword)}</table>
     <p>You will be required to set a new password on first login. Please keep this password confidential.</p>`
  );
  return sendMail({ to, subject: 'Your Chhayabithi HMS Account', html });
}

async function notifyPasswordReset({ to, name, temporaryPassword }) {
  const html = layout(
    'Password Reset',
    `<p>Dear ${name},</p><p>Your Chhayabithi HMS password has been reset by an administrator.</p>
     <table>${row('Temporary Password', temporaryPassword)}</table>
     <p>You will be required to set a new password on your next login. If you did not expect this, contact your administrator immediately.</p>`
  );
  return sendMail({ to, subject: 'Your Password Has Been Reset', html });
}

module.exports = {
  sendMail,
  notifyAppointmentBooked,
  notifyAppointmentRescheduled,
  notifyAppointmentCancelled,
  notifyPrescriptionCreated,
  notifyInvoiceCreated,
  notifyPaymentReceived,
  notifyDiscountDecision,
  notifyAccountCreated,
  notifyPasswordReset
};
