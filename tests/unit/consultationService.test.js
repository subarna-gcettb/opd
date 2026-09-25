jest.mock('../../config/database', () => ({
  pool: { execute: jest.fn() },
  withTransaction: jest.fn()
}));

const { pool } = require('../../config/database');
const consultationService = require('../../services/consultationService');
const AppError = require('../../utils/AppError');

describe('consultationService.assertDoctorCanAccessVisit', () => {
  beforeEach(() => {
    pool.execute.mockReset();
  });

  test('throws 404 when the visit does not exist', async () => {
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(
      consultationService.assertDoctorCanAccessVisit(999, { roles: ['DOCTOR'], doctorId: 5 })
    ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
  });

  test('a doctor cannot open a visit belonging to another doctor (IDOR guard)', async () => {
    pool.execute.mockResolvedValueOnce([[{ doctor_id: 14 }]]);
    await expect(
      consultationService.assertDoctorCanAccessVisit(1, { roles: ['DOCTOR'], doctorId: 22 })
    ).rejects.toThrow(/not authorized/i);
  });

  test('a doctor can open their own visit', async () => {
    pool.execute.mockResolvedValueOnce([[{ doctor_id: 14 }]]);
    await expect(
      consultationService.assertDoctorCanAccessVisit(1, { roles: ['DOCTOR'], doctorId: 14 })
    ).resolves.toBe(true);
  });

  test('a Super Admin can open any visit regardless of doctorId', async () => {
    pool.execute.mockResolvedValueOnce([[{ doctor_id: 14 }]]);
    await expect(
      consultationService.assertDoctorCanAccessVisit(1, { roles: ['SUPER_ADMIN'], doctorId: null })
    ).resolves.toBe(true);
  });
});
