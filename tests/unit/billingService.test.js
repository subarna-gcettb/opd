// Mock the DB layer so we can test business-rule branches without a real MySQL server.
jest.mock('../../config/database', () => {
  const conn = {
    execute: jest.fn()
  };
  return {
    pool: { execute: jest.fn() },
    withTransaction: jest.fn(async (callback) => callback(conn)),
    __conn: conn
  };
});
jest.mock('../../services/auditService', () => ({ log: jest.fn() }));

const { withTransaction, __conn: conn } = require('../../config/database');
const billingService = require('../../services/billingService');
const AppError = require('../../utils/AppError');

describe('billingService.decideDiscount — self-approval rule', () => {
  beforeEach(() => {
    conn.execute.mockReset();
  });

  test('rejects when the approver is the same user who requested the discount', async () => {
    const requesterId = 42;
    conn.execute.mockImplementationOnce(async () => [
      [{ id: 1, invoice_id: 10, requested_by: requesterId, status: 'PENDING' }]
    ]);

    await expect(billingService.decideDiscount(1, 'APPROVED', requesterId)).rejects.toThrow(
      /cannot approve or reject your own discount request/i
    );
  });

  test('rejects deciding a request that is not PENDING', async () => {
    conn.execute.mockImplementationOnce(async () => [
      [{ id: 1, invoice_id: 10, requested_by: 42, status: 'APPROVED' }]
    ]);

    await expect(billingService.decideDiscount(1, 'APPROVED', 99)).rejects.toThrow(
      /already been decided/i
    );
  });

  test('a different approver can approve a pending request', async () => {
    const requesterId = 42;
    const approverId = 7;

    // Sequence of conn.execute calls inside decideDiscount for the APPROVED path:
    // 1) SELECT discount_requests ... FOR UPDATE
    // 2) SELECT invoices ... FOR UPDATE
    // 3) UPDATE invoices
    // 4) UPDATE discount_requests
    conn.execute
      .mockImplementationOnce(async () => [[{ id: 1, invoice_id: 10, requested_by: requesterId, status: 'PENDING', requested_amount: 100, requested_percentage: null }]])
      .mockImplementationOnce(async () => [[{ id: 10, gross_amount: '500.00', status: 'AWAITING_PAYMENT' }]])
      .mockImplementationOnce(async () => [{}])
      .mockImplementationOnce(async () => [{}]);

    await expect(billingService.decideDiscount(1, 'APPROVED', approverId)).resolves.toBeUndefined();
    expect(withTransaction).toHaveBeenCalled();
  });

  test('rejects approving a discount larger than the invoice gross amount', async () => {
    conn.execute
      .mockImplementationOnce(async () => [[{ id: 1, invoice_id: 10, requested_by: 42, status: 'PENDING', requested_amount: 999999, requested_percentage: null }]])
      .mockImplementationOnce(async () => [[{ id: 10, gross_amount: '500.00', status: 'AWAITING_PAYMENT' }]]);

    await expect(billingService.decideDiscount(1, 'APPROVED', 7)).rejects.toThrow(AppError);
  });
});

describe('billingService.recordPayment — amount and discount guards', () => {
  beforeEach(() => {
    conn.execute.mockReset();
  });

  test('rejects a payment amount that does not match the invoice net amount', async () => {
    conn.execute
      .mockImplementationOnce(async () => [[{ id: 10, status: 'AWAITING_PAYMENT', net_amount: '450.00' }]])
      .mockImplementationOnce(async () => [[]]); // no pending discount requests

    await expect(
      billingService.recordPayment(10, { amount: '999.00', method: 'CASH' }, 1)
    ).rejects.toThrow(/must equal the invoice net amount/i);
  });

  test('rejects recording payment while a discount request is still pending', async () => {
    conn.execute
      .mockImplementationOnce(async () => [[{ id: 10, status: 'AWAITING_PAYMENT', net_amount: '450.00' }]])
      .mockImplementationOnce(async () => [[{ id: 5 }]]); // a pending discount request exists

    await expect(
      billingService.recordPayment(10, { amount: '450.00', method: 'CASH' }, 1)
    ).rejects.toThrow(/still pending Super Admin approval/i);
  });

  test('requires a reference number for UPI/Card payments', async () => {
    conn.execute
      .mockImplementationOnce(async () => [[{ id: 10, status: 'AWAITING_PAYMENT', net_amount: '450.00' }]])
      .mockImplementationOnce(async () => [[]]);

    await expect(
      billingService.recordPayment(10, { amount: '450.00', method: 'UPI' }, 1)
    ).rejects.toThrow(/reference number is required/i);
  });
});
