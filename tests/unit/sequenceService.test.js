const sequenceService = require('../../services/sequenceService');

/**
 * Fake transaction connection simulating `sequence_counters` in memory,
 * closely enough to exercise nextValue's INSERT-IF-MISSING + locked
 * SELECT + UPDATE sequence without a real MySQL server.
 */
function createFakeConn() {
  const table = new Map(); // scopeKey -> value

  return {
    async execute(sql, params) {
      if (sql.startsWith('INSERT INTO sequence_counters')) {
        if (!table.has(params.scopeKey)) table.set(params.scopeKey, 0);
        return [{}];
      }
      if (sql.startsWith('SELECT current_value')) {
        return [[{ current_value: table.get(params.scopeKey) }]];
      }
      if (sql.startsWith('UPDATE sequence_counters')) {
        table.set(params.scopeKey, params.next);
        return [{}];
      }
      throw new Error(`Unexpected SQL in fake conn: ${sql}`);
    },
    _table: table
  };
}

describe('sequenceService', () => {
  test('pad zero-pads a number to the requested width', () => {
    expect(sequenceService.pad(7, 4)).toBe('0007');
    expect(sequenceService.pad(1234, 4)).toBe('1234');
    expect(sequenceService.pad(1, 7)).toBe('0000001');
  });

  test('nextValue starts at 1 for a brand-new scope', async () => {
    const conn = createFakeConn();
    const value = await sequenceService.nextValue(conn, 'healthid:26:01');
    expect(value).toBe(1);
  });

  test('nextValue increments sequentially for the same scope', async () => {
    const conn = createFakeConn();
    const a = await sequenceService.nextValue(conn, 'invoice:2026:01');
    const b = await sequenceService.nextValue(conn, 'invoice:2026:01');
    const c = await sequenceService.nextValue(conn, 'invoice:2026:01');
    expect([a, b, c]).toEqual([1, 2, 3]);
  });

  test('different scopes are tracked independently', async () => {
    const conn = createFakeConn();
    const branchA1 = await sequenceService.nextValue(conn, 'healthid:26:01');
    const branchB1 = await sequenceService.nextValue(conn, 'healthid:26:02');
    const branchA2 = await sequenceService.nextValue(conn, 'healthid:26:01');
    expect(branchA1).toBe(1);
    expect(branchB1).toBe(1); // independent scope, starts fresh
    expect(branchA2).toBe(2);
  });

  test('per-doctor-per-day token scopes never collide across doctors', async () => {
    const conn = createFakeConn();
    const drAToken1 = await sequenceService.nextValue(conn, 'token:doctor:14:2026-09-16');
    const drBToken1 = await sequenceService.nextValue(conn, 'token:doctor:22:2026-09-16');
    const drAToken2 = await sequenceService.nextValue(conn, 'token:doctor:14:2026-09-16');
    expect(drAToken1).toBe(1);
    expect(drBToken1).toBe(1); // same day, different doctor -> both can be "Token 001"
    expect(drAToken2).toBe(2);
  });
});
