const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const billingController = require('../controllers/billingController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { handleValidation } = require('../middleware/validation');
const { csrfProtection } = require('../middleware/csrf');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth);

router.get('/invoices/new', requirePermission('billing.create'), asyncHandler(billingController.showNewInvoiceForm));
router.post(
  '/invoices/new',
  requirePermission('billing.create'),
  csrfProtection,
  [body('visitId').isInt().withMessage('Visit is required')],
  handleValidation,
  asyncHandler(billingController.createInvoice)
);

router.get('/invoices', requirePermission('billing.view'), asyncHandler(billingController.listInvoices));
router.get('/invoices/:id', requirePermission('billing.view', 'discount.request'), asyncHandler(billingController.viewInvoice));
router.get('/invoices/:id/print', requirePermission('billing.view'), asyncHandler(billingController.printInvoice));
router.get('/invoices/:id/receipt/:paymentId', requirePermission('billing.view'), asyncHandler(billingController.printReceipt));

router.post(
  '/invoices/:id/discount-request',
  requirePermission('discount.request'),
  csrfProtection,
  asyncHandler(billingController.requestDiscount)
);

router.get('/discount-requests', requirePermission('discount.approve'), asyncHandler(billingController.listDiscountRequests));
router.post(
  '/discount-requests/:id/decide',
  requirePermission('discount.approve'),
  csrfProtection,
  asyncHandler(billingController.decideDiscount)
);

router.post(
  '/invoices/:id/payment',
  requirePermission('payment.record'),
  csrfProtection,
  [
    body('amount').isFloat({ min: 0 }).withMessage('Amount is required'),
    body('method').isIn(['CASH', 'UPI', 'CARD']).withMessage('Select a payment method')
  ],
  handleValidation,
  asyncHandler(billingController.recordPayment)
);

module.exports = router;
