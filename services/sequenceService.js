/**
 * Generic, concurrency-safe sequence generator.
 * Every identifier type is backed by sequence_counters and generated inside
 * the caller's transaction.
 */

async function ensureAtLeast(conn, scopeKey, minimumValue) {
  const minimum = Math.max(0, Number(minimumValue) || 0);

  await conn.execute(
    'INSERT INTO sequence_counters (scope_key, current_value) VALUES (:scopeKey, 0) ' +
      'ON DUPLICATE KEY UPDATE scope_key = scope_key',
    { scopeKey }
  );

  const [rows] = await conn.execute(
    'SELECT current_value FROM sequence_counters WHERE scope_key = :scopeKey FOR UPDATE',
    { scopeKey }
  );
  const current = Number(rows[0].current_value) || 0;

  if (current < minimum) {
    await conn.execute(
      'UPDATE sequence_counters SET current_value = :minimum WHERE scope_key = :scopeKey',
      { minimum, scopeKey }
    );
  }

  return Math.max(current, minimum);
}

async function nextValue(conn, scopeKey) {
  await conn.execute(
    'INSERT INTO sequence_counters (scope_key, current_value) VALUES (:scopeKey, 0) ' +
      'ON DUPLICATE KEY UPDATE scope_key = scope_key',
    { scopeKey }
  );

  const [rows] = await conn.execute(
    'SELECT current_value FROM sequence_counters WHERE scope_key = :scopeKey FOR UPDATE',
    { scopeKey }
  );
  const next = Number(rows[0].current_value) + 1;

  await conn.execute(
    'UPDATE sequence_counters SET current_value = :next WHERE scope_key = :scopeKey',
    { next, scopeKey }
  );

  return next;
}

function pad(num, width) {
  return String(num).padStart(width, '0');
}

module.exports = { ensureAtLeast, nextValue, pad };
