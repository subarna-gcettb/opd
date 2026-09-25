const { pool, withTransaction } = require('../config/database');
const sequenceService = require('./sequenceService');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

async function generateInvoiceNumber(conn, dateStr) {
  const compact = dateStr.replace(/-/g, '').slice(2);
  const seq = await sequenceService.nextValue(conn, `invoice:${dateStr}`);
  return `INV${compact}${sequenceService.pad(seq, 5)}`;
}

async function generatePaymentCode(conn, dateStr) {
  const compact = dateStr.replace(/-/g, '').slice(2);
  const seq = await sequenceService.nextValue(conn, `payment:${dateStr}`);
  return `PAY${compact}${sequenceService.pad(seq, 5)}`;
}

async function generateReceiptNumber(conn, dateStr) {
  const compact = dateStr.replace(/-/g, '').slice(2);
  const seq = await sequenceService.nextValue(conn, `receipt:${dateStr}`);
  return `RCPT${compact}${sequenceService.pad(seq, 5)}`;
}

/**
 * Creates an OPD invoice for a visit: consultation fee line + any other
 * charges the operator adds. gross_amount = sum(items); discount_amount
 * starts at 0 and can ONLY be changed via the approved discount workflow
 * (see approveDiscount below) or directly by a Super Admin override at
 * creation time (not exposed here — kept out of the normal flow).
 */
async function createInvoice(visitId, otherCharges, actorUserId) {
  return withTransaction(async (conn) => {
    const [[visit]] = await conn.execute(
      `SELECT v.id, v.patient_id, v.doctor_id, v.branch_id, a.department_id, d.consultation_fee
       FROM opd_visits v
       JOIN appointments a ON a.id = v.appointment_id
       JOIN doctors d ON d.id = v.doctor_id
       WHERE v.id = :id`,
      { id: visitId }
    );
    if (!visit) throw new AppError('Visit not found', 404);

    const [existing] = await conn.execute("SELECT id FROM invoices WHERE visit_id = :id AND status <> 'CANCELLED'", {
      id: visitId
    });
    if (existing.length) throw new AppError('An invoice already exists for this visit', 409);

    const dateStr = new Date().toISOString().slice(0, 10);
    const invoiceNumber = await generateInvoiceNumber(conn, dateStr);

    const items = [{ description: 'OPD Consultation Fee', item_type: 'CONSULTATION', amount: Number(visit.consultation_fee) }];
    (otherCharges || []).forEach((c) => {
      if (c.description && c.amount) {
        items.push({ description: c.description, item_type: 'OTHER', amount: Number(c.amount) });
      }
    });
    const grossAmount = items.reduce((sum, i) => sum + i.amount, 0);

    const [result] = await conn.execute(
      `INSERT INTO invoices
        (invoice_number, patient_id, visit_id, doctor_id, department_id, branch_id,
         gross_amount, discount_amount, net_amount, status, created_by)
       VALUES (:invoiceNumber, :patientId, :visitId, :doctorId, :departmentId, :branchId,
         :gross, 0, :gross, 'AWAITING_PAYMENT', :createdBy)`,
      {
        invoiceNumber,
        patientId: visit.patient_id,
        visitId,
        doctorId: visit.doctor_id,
        departmentId: visit.department_id,
        branchId: visit.branch_id,
        gross: grossAmount,
        createdBy: actorUserId
      }
    );
    const invoiceId = result.insertId;

    for (const item of items) {
      await conn.execute(
        'INSERT INTO invoice_items (invoice_id, description, item_type, amount) VALUES (:invoiceId, :description, :itemType, :amount)',
        { invoiceId, description: item.description, itemType: item.item_type, amount: item.amount }
      );
    }

    await auditService.log(
      {
        userId: actorUserId,
        action: 'INVOICE_CREATED',
        entity: 'invoice',
        entityId: invoiceId,
        newValue: { invoiceNumber, grossAmount }
      },
      conn
    );

    return { id: invoiceId, invoiceNumber, grossAmount };
  });
}

async function getInvoice(invoiceId) {
  const [[invoice]] = await pool.execute(
    `SELECT i.*, p.health_id, p.name AS patient_name, p.age_years, p.gender,
            u.name AS doctor_name, dept.name AS department_name, b.name AS branch_name
     FROM invoices i
     JOIN patients p ON p.id = i.patient_id
     JOIN doctors d ON d.id = i.doctor_id
     JOIN users u ON u.id = d.user_id
     JOIN departments dept ON dept.id = i.department_id
     JOIN branches b ON b.id = i.branch_id
     WHERE i.id = :id`,
    { id: invoiceId }
  );
  if (!invoice) return null;

  const [items] = await pool.execute('SELECT * FROM invoice_items WHERE invoice_id = :id', { id: invoiceId });
  const [payments] = await pool.execute(
    `SELECT p.*, u.name AS paid_by_name FROM payments p JOIN users u ON u.id = p.paid_by
     WHERE p.invoice_id = :id ORDER BY p.paid_at DESC`,
    { id: invoiceId }
  );
  const [discountRequests] = await pool.execute(
    `SELECT dr.*, ru.name AS requested_by_name, au.name AS approved_by_name
     FROM discount_requests dr
     JOIN users ru ON ru.id = dr.requested_by
     LEFT JOIN users au ON au.id = dr.approved_by
     WHERE dr.invoice_id = :id ORDER BY dr.requested_at DESC`,
    { id: invoiceId }
  );

  return { invoice, items, payments, discountRequests };
}

async function listInvoices({ status = null, page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  // pool.query (not execute) — see note in patientService.searchPatients
  // re: mysql2's execute()+bound-LIMIT prepared-statement bug.
  const [rows] = await pool.query(
    `SELECT i.id, i.invoice_number, i.created_at, i.gross_amount, i.discount_amount, i.net_amount, i.status,
            p.health_id, p.name AS patient_name, u.name AS doctor_name
     FROM invoices i
     JOIN patients p ON p.id = i.patient_id
     JOIN doctors d ON d.id = i.doctor_id
     JOIN users u ON u.id = d.user_id
     WHERE (:status IS NULL OR i.status = :status)
     ORDER BY i.created_at DESC LIMIT :limit OFFSET :offset`,
    { status, limit: pageSize, offset }
  );
  const [[{ total }]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM invoices i WHERE (:status IS NULL OR i.status = :status)',
    { status }
  );
  return { rows, total, page, pageSize };
}

/**
 * Doctor or staff REQUESTS a discount. Requires a reason. Cannot be
 * self-approved — enforced both here (status stays PENDING) and in
 * approveDiscount (actor != requester check).
 */
async function requestDiscount(invoiceId, payload, actorUserId) {
  return withTransaction(async (conn) => {
    const [[invoice]] = await conn.execute('SELECT * FROM invoices WHERE id = :id FOR UPDATE', { id: invoiceId });
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (invoice.status === 'PAID') throw new AppError('Cannot request a discount on an already-paid invoice', 409);

    const [pending] = await conn.execute(
      "SELECT id FROM discount_requests WHERE invoice_id = :id AND status = 'PENDING'",
      { id: invoiceId }
    );
    if (pending.length) throw new AppError('A discount request is already pending for this invoice', 409);

    if (!payload.reason || !payload.reason.trim()) throw new AppError('A reason is required', 422);
    if (!payload.amount && !payload.percentage) {
      throw new AppError('Provide either a discount amount or a percentage', 422);
    }

    const [result] = await conn.execute(
      `INSERT INTO discount_requests (invoice_id, requested_amount, requested_percentage, reason, requested_by, status)
       VALUES (:invoiceId, :amount, :percentage, :reason, :requestedBy, 'PENDING')`,
      {
        invoiceId,
        amount: payload.amount || null,
        percentage: payload.percentage || null,
        reason: payload.reason.trim(),
        requestedBy: actorUserId
      }
    );

    await auditService.log(
      {
        userId: actorUserId,
        action: 'DISCOUNT_REQUESTED',
        entity: 'discount_request',
        entityId: result.insertId,
        newValue: { invoiceId, amount: payload.amount, percentage: payload.percentage, reason: payload.reason }
      },
      conn
    );

    return { id: result.insertId };
  });
}

/**
 * Super Admin approves or rejects. A user can never approve their own
 * request — enforced here, not just in the UI.
 */
async function decideDiscount(discountRequestId, decision, actorUserId, rejectionReason = null) {
  return withTransaction(async (conn) => {
    const [[request]] = await conn.execute(
      'SELECT * FROM discount_requests WHERE id = :id FOR UPDATE',
      { id: discountRequestId }
    );
    if (!request) throw new AppError('Discount request not found', 404);
    if (request.status !== 'PENDING') throw new AppError('This request has already been decided', 409);

    if (request.requested_by === actorUserId) {
      throw new AppError('You cannot approve or reject your own discount request', 403);
    }

    if (decision === 'APPROVED') {
      const [[invoice]] = await conn.execute('SELECT * FROM invoices WHERE id = :id FOR UPDATE', {
        id: request.invoice_id
      });
      if (!invoice) throw new AppError('Invoice not found', 404);
      if (invoice.status === 'PAID') throw new AppError('This invoice has already been paid', 409);

      const discountAmount = request.requested_amount
        ? Number(request.requested_amount)
        : Number(((Number(request.requested_percentage) / 100) * Number(invoice.gross_amount)).toFixed(2));

      if (discountAmount > Number(invoice.gross_amount)) {
        throw new AppError('Discount cannot exceed the gross invoice amount', 422);
      }

      const netAmount = Number(invoice.gross_amount) - discountAmount;

      await conn.execute(
        'UPDATE invoices SET discount_amount = :discount, net_amount = :net WHERE id = :id',
        { discount: discountAmount, net: netAmount, id: invoice.id }
      );

      await conn.execute(
        "UPDATE discount_requests SET status = 'APPROVED', approved_by = :approvedBy, approved_at = NOW() WHERE id = :id",
        { approvedBy: actorUserId, id: discountRequestId }
      );

      await auditService.log(
        {
          userId: actorUserId,
          action: 'DISCOUNT_APPROVED',
          entity: 'discount_request',
          entityId: discountRequestId,
          newValue: { invoiceId: invoice.id, discountAmount, netAmount }
        },
        conn
      );
    } else {
      await conn.execute(
        "UPDATE discount_requests SET status = 'REJECTED', approved_by = :approvedBy, approved_at = NOW(), rejection_reason = :reason WHERE id = :id",
        { approvedBy: actorUserId, reason: rejectionReason || null, id: discountRequestId }
      );
      await auditService.log(
        {
          userId: actorUserId,
          action: 'DISCOUNT_REJECTED',
          entity: 'discount_request',
          entityId: discountRequestId,
          newValue: { reason: rejectionReason }
        },
        conn
      );
    }
  });
}

async function listPendingDiscountRequests() {
  const [rows] = await pool.execute(
    `SELECT dr.*, i.invoice_number, i.gross_amount, i.net_amount,
            p.name AS patient_name, p.health_id, ru.name AS requested_by_name
     FROM discount_requests dr
     JOIN invoices i ON i.id = dr.invoice_id
     JOIN patients p ON p.id = i.patient_id
     JOIN users ru ON ru.id = dr.requested_by
     WHERE dr.status = 'PENDING'
     ORDER BY dr.requested_at`
  );
  return rows;
}

/**
 * Records a payment. Only the currently-approved discount (if any) is
 * ever reflected in net_amount — this function never applies an
 * unapproved discount because it only reads invoices.net_amount, which
 * decideDiscount is the sole writer of.
 */
async function recordPayment(invoiceId, payload, actorUserId) {
  return withTransaction(async (conn) => {
    const [[invoice]] = await conn.execute('SELECT * FROM invoices WHERE id = :id FOR UPDATE', { id: invoiceId });
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (invoice.status === 'PAID') throw new AppError('This invoice has already been paid', 409);
    if (invoice.status === 'CANCELLED') throw new AppError('This invoice was cancelled', 409);

    const pendingDiscount = await conn.execute(
      "SELECT id FROM discount_requests WHERE invoice_id = :id AND status = 'PENDING'",
      { id: invoiceId }
    );
    if (pendingDiscount[0].length) {
      throw new AppError('A discount request is still pending Super Admin approval for this invoice', 409);
    }

    const amount = Number(payload.amount);
    if (Math.abs(amount - Number(invoice.net_amount)) > 0.01) {
      throw new AppError(
        `Payment amount (₹${amount.toFixed(2)}) must equal the invoice net amount (₹${Number(invoice.net_amount).toFixed(2)})`,
        422
      );
    }
    if (!['CASH', 'UPI', 'CARD'].includes(payload.method)) throw new AppError('Invalid payment method', 422);
    if (payload.method !== 'CASH' && !payload.referenceNumber) {
      throw new AppError('A transaction/reference number is required for UPI/Card payments', 422);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const paymentCode = await generatePaymentCode(conn, dateStr);
    const receiptNumber = await generateReceiptNumber(conn, dateStr);

    const [result] = await conn.execute(
      `INSERT INTO payments (payment_code, receipt_number, invoice_id, patient_id, amount, method, reference_number, paid_by)
       VALUES (:code, :receiptNumber, :invoiceId, :patientId, :amount, :method, :ref, :paidBy)`,
      {
        code: paymentCode,
        receiptNumber,
        invoiceId,
        patientId: invoice.patient_id,
        amount,
        method: payload.method,
        ref: payload.method === 'CASH' ? payload.referenceNumber || null : payload.referenceNumber,
        paidBy: actorUserId
      }
    );

    await conn.execute("UPDATE invoices SET status = 'PAID' WHERE id = :id", { id: invoiceId });

    await auditService.log(
      {
        userId: actorUserId,
        action: 'PAYMENT_RECORDED',
        entity: 'payment',
        entityId: result.insertId,
        newValue: { invoiceId, amount, method: payload.method, receiptNumber }
      },
      conn
    );

    return { paymentId: result.insertId, paymentCode, receiptNumber };
  });
}

module.exports = {
  createInvoice,
  getInvoice,
  listInvoices,
  requestDiscount,
  decideDiscount,
  listPendingDiscountRequests,
  recordPayment
};
