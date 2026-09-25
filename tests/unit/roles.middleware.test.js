const { requirePermission, requireRole } = require('../../middleware/roles');

function mockRes() {
  return {};
}

describe('requirePermission', () => {
  test('calls next(AppError 401) when there is no authenticated user', () => {
    const next = jest.fn();
    requirePermission('patient.view')({ user: null }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('calls next(AppError 403) when the user lacks the permission', () => {
    const next = jest.fn();
    const req = { user: { permissions: ['patient.view'] } };
    requirePermission('discount.approve')(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  test('calls next() with no error when the user has one of the required permissions', () => {
    const next = jest.fn();
    const req = { user: { permissions: ['patient.view', 'appointment.create'] } };
    requirePermission('discount.approve', 'appointment.create')(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
  });
});

describe('requireRole', () => {
  test('rejects a user without the required role', () => {
    const next = jest.fn();
    const req = { user: { roles: ['OPD_STAFF'] } };
    requireRole('SUPER_ADMIN')(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  test('accepts a user with a matching role', () => {
    const next = jest.fn();
    const req = { user: { roles: ['DOCTOR'] } };
    requireRole('SUPER_ADMIN', 'DOCTOR')(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});
