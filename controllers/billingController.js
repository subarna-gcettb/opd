const billingService = require('../services/billingService');
const emailService = require('../services/emailService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');

async function showNewInvoiceForm(req, res, next) {
  try {
    const visitId = req.query.visitId;
    const [[visit]] = await pool.execute(
      `SELECT v.id, p.health_id, p.name AS patient_name, u.name AS doctor_name, d.consultation_fee, dept.name AS department_name
       FROM opd_visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN doctors d ON d.id = v.doctor_id
       JOIN users u ON u.id = d.user_id
       JOIN appointments a ON a.id = v.appointment_id
       JOIN departments dept ON dept.id = a.department_id
       WHERE v.id = :id`,
      { id: visitId }
    );
    if (!visit) throw new AppError('Visit not found', 404);
    res.render('billing/new-invoice', { title: 'Generate Invoice', visit });
  } catch (err) {
    next(err);
  }
}

async function createInvoice(req, res, next) {
  try {
    const otherCharges = [].concat(req.body.otherDescription || []).map((desc, i) => ({
      description: desc,
      amount: [].concat(req.body.otherAmount || [])[i]
    }));
    const result = await billingService.createInvoice(req.body.visitId, otherCharges, req.user.id);
    req.flash('success', `Invoice ${result.invoiceNumber} created.`);

    notifyInvoiceCreated(result.id).catch(() => {});

    res.redirect(`/billing/invoices/${result.id}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/billing/invoices/new?visitId=${req.body.visitId}`);
    }
    next(err);
  }
}

async function notifyInvoiceCreated(invoiceId) {
  const data = await billingService.getInvoice(invoiceId);
  if (!data) return;
  const [[row]] = await pool.execute('SELECT email FROM patients WHERE id = :id', { id: data.invoice.patient_id });
  if (!row || !row.email) return;
  await emailService.notifyInvoiceCreated({
    to: row.email,
    patientName: data.invoice.patient_name,
    healthId: data.invoice.health_id,
    invoiceNumber: data.invoice.invoice_number,
    netAmount: data.invoice.net_amount,
    doctorName: data.invoice.doctor_name
  });
}

async function listInvoices(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const data = await billingService.listInvoices({ status: req.query.status || null, page, pageSize: 25 });
    res.render('billing/invoices', { title: 'OPD Bills', ...data, status: req.query.status || '', totalPages: Math.ceil(data.total / data.pageSize) });
  } catch (err) {
    next(err);
  }
}

async function viewInvoice(req, res, next) {
  try {
    const data = await billingService.getInvoice(req.params.id);
    if (!data) throw new AppError('Invoice not found', 404);

    const hasFullBillingView = req.user.permissions.includes('billing.view');
    if (!hasFullBillingView) {
      // Doctor reaching this page only via discount.request: restrict
      // to invoices for patients they personally treated.
      if (!req.user.doctorId || data.invoice.doctor_id !== req.user.doctorId) {
        throw new AppError('You can only view invoices for your own patients', 403);
      }
    }

    res.render('billing/invoice-detail', { title: `Invoice ${data.invoice.invoice_number}`, ...data });
  } catch (err) {
    next(err);
  }
}

async function requestDiscount(req, res, next) {
  try {
    await billingService.requestDiscount(
      req.params.id,
      { amount: req.body.amount || null, percentage: req.body.percentage || null, reason: req.body.reason },
      req.user.id
    );
    req.flash('success', 'Discount request submitted for Super Admin approval.');
    res.redirect(`/billing/invoices/${req.params.id}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/billing/invoices/${req.params.id}`);
    }
    next(err);
  }
}

async function listDiscountRequests(req, res, next) {
  try {
    const rows = await billingService.listPendingDiscountRequests();
    res.render('billing/discount-requests', { title: 'Pending Discount Requests', rows });
  } catch (err) {
    next(err);
  }
}

async function decideDiscount(req, res, next) {
  try {
    await billingService.decideDiscount(req.params.id, req.body.decision, req.user.id, req.body.rejectionReason);
    req.flash('success', `Discount request ${req.body.decision.toLowerCase()}.`);

    notifyDiscountDecision(req.params.id, req.body.decision, req.body.rejectionReason).catch(() => {});

    res.redirect('/billing/discount-requests');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/billing/discount-requests');
    }
    next(err);
  }
}

async function notifyDiscountDecision(discountRequestId, status, rejectionReason) {
  const [[row]] = await pool.execute(
    `SELECT ru.name AS requester_name, ru.email AS requester_email, i.invoice_number
     FROM discount_requests dr
     JOIN users ru ON ru.id = dr.requested_by
     JOIN invoices i ON i.id = dr.invoice_id
     WHERE dr.id = :id`,
    { id: discountRequestId }
  );
  if (!row || !row.requester_email) return;
  await emailService.notifyDiscountDecision({
    to: row.requester_email,
    recipientName: row.requester_name,
    invoiceNumber: row.invoice_number,
    status,
    rejectionReason
  });
}

async function recordPayment(req, res, next) {
  try {
    const result = await billingService.recordPayment(
      req.params.id,
      { amount: req.body.amount, method: req.body.method, referenceNumber: req.body.referenceNumber },
      req.user.id
    );
    req.flash('success', `Payment recorded. Receipt ${result.receiptNumber}.`);

    notifyPaymentReceived(req.params.id, result).catch(() => {});

    res.redirect(`/billing/invoices/${req.params.id}/receipt/${result.paymentId}`);
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect(`/billing/invoices/${req.params.id}`);
    }
    next(err);
  }
}

async function notifyPaymentReceived(invoiceId, result) {
  const data = await billingService.getInvoice(invoiceId);
  if (!data) return;
  const [[row]] = await pool.execute('SELECT email FROM patients WHERE id = :id', { id: data.invoice.patient_id });
  if (!row || !row.email) return;
  const payment = data.payments.find((p) => p.id === result.paymentId);
  await emailService.notifyPaymentReceived({
    to: row.email,
    patientName: data.invoice.patient_name,
    healthId: data.invoice.health_id,
    invoiceNumber: data.invoice.invoice_number,
    amount: payment ? payment.amount : data.invoice.net_amount,
    method: payment ? payment.method : '',
    receiptNumber: result.receiptNumber
  });
}

async function printReceipt(req, res, next) {
  try {
    const data = await billingService.getInvoice(req.params.id);
    if (!data) throw new AppError('Invoice not found', 404);
    const payment = data.payments.find((p) => p.id === Number(req.params.paymentId));
    if (!payment) throw new AppError('Payment not found', 404);
    res.render('print/receipt', { layout: 'layouts/blank', title: 'Receipt', ...data, payment });
  } catch (err) {
    next(err);
  }
}

async function printInvoice(req, res, next) {
  try {
    const data = await billingService.getInvoice(req.params.id);
    if (!data) throw new AppError('Invoice not found', 404);
    res.render('print/invoice', { layout: 'layouts/blank', title: 'Invoice', ...data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  showNewInvoiceForm,
  createInvoice,
  listInvoices,
  viewInvoice,
  requestDiscount,
  listDiscountRequests,
  decideDiscount,
  recordPayment,
  printReceipt,
  printInvoice
};
