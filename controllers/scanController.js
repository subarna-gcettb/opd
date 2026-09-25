const { pool } = require('../config/database');
const AppError = require('../utils/AppError');

/**
 * Resolves a scanned code to the right page. Accepts whatever a barcode
 * reader emits (it types the encoded text + Enter, exactly like a
 * keyboard) for any of the identifiers we print barcodes/QR-style codes
 * for in this system:
 *   - 11-digit Health ID           -> patient profile
 *   - APT-prefixed appointment code -> appointment detail (token, doctor,
 *                                      queue status, everything staff need)
 *   - RX-prefixed prescription code -> prescription (current version)
 *   - INV-prefixed invoice number    -> invoice detail
 *   - VIS-prefixed visit code        -> the visit's appointment detail
 * Authenticated + permission-gated; there is no public scan endpoint.
 */
async function resolve(req, res, next) {
  try {
    const raw = (req.query.code || req.body.code || '').trim();
    if (!raw) throw new AppError('No code scanned', 422);

    // Health ID: 11 digits, per healthIdService's YYBBSSSSSSS format.
    if (/^\d{11}$/.test(raw)) {
      const [[patient]] = await pool.execute(
        'SELECT health_id FROM patients WHERE health_id = :code AND deleted_at IS NULL LIMIT 1',
        { code: raw }
      );
      if (!patient) throw new AppError(`No patient found for Health ID ${raw}`, 404);
      return res.redirect(`/patients/${patient.health_id}`);
    }

    if (/^APT/i.test(raw)) {
      const [[appt]] = await pool.execute(
        `SELECT a.id, a.doctor_id, a.appointment_date, a.status AS appointment_status,
                v.id AS visit_id, v.status AS visit_status
         FROM appointments a
         LEFT JOIN opd_visits v ON v.appointment_id = a.id
         WHERE a.appointment_code = :code LIMIT 1`,
        { code: raw.toUpperCase() }
      );
      if (!appt) throw new AppError(`No appointment found for code ${raw}`, 404);

      const isDoctor = Boolean(req.user.doctorId);
      if (isDoctor) {
        if (appt.doctor_id !== req.user.doctorId) throw new AppError('This appointment is assigned to another doctor.', 403);
        if (appt.appointment_date instanceof Date) appt.appointment_date = appt.appointment_date.toISOString().slice(0,10);
        const today = new Date().toISOString().slice(0,10);
        if (String(appt.appointment_date).slice(0,10) !== today) throw new AppError('This appointment is not for today.', 409);
        if (!appt.visit_id || !['WAITING','CALLED','IN_CONSULTATION'].includes(appt.visit_status)) {
          throw new AppError('This patient is not currently in today’s active queue.', 409);
        }
        return res.redirect(`/doctor/consultation/${appt.visit_id}`);
      }
      return res.redirect(`/opd/appointments/${appt.id}`);
    }

    if (/^RX/i.test(raw)) {
      const [[presc]] = await pool.execute(
        'SELECT id FROM prescriptions WHERE prescription_code = :code AND is_current = 1',
        { code: raw.toUpperCase() }
      );
      if (!presc) throw new AppError(`No current prescription found for code ${raw}`, 404);
      return res.redirect(`/prescriptions/${presc.id}`);
    }

    if (/^INV/i.test(raw)) {
      const [[inv]] = await pool.execute('SELECT id FROM invoices WHERE invoice_number = :code', {
        code: raw.toUpperCase()
      });
      if (!inv) throw new AppError(`No invoice found for number ${raw}`, 404);
      return res.redirect(`/billing/invoices/${inv.id}`);
    }

    if (/^VIS/i.test(raw)) {
      const [[visit]] = await pool.execute('SELECT appointment_id FROM opd_visits WHERE visit_code = :code', {
        code: raw.toUpperCase()
      });
      if (!visit) throw new AppError(`No visit found for code ${raw}`, 404);
      return res.redirect(`/opd/appointments/${visit.appointment_id}`);
    }

    throw new AppError(`"${raw}" doesn't match a known code format (Health ID, appointment, prescription, invoice, or visit code)`, 422);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(req.get('Referer') || '/dashboard');
    }
    next(err);
  }
}

module.exports = { resolve };
