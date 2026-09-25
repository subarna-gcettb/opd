/**
 * Generic, concurrency-safe sequence generator.
 *
 * Every identifier type in the system (Health ID, Registration Number,
 * Appointment Code, Visit Code, Prescription Code, Invoice Number,
 * Receipt/Payment Code, per-doctor-per-day Token) is backed by a row in
 * `sequence_counters`, keyed by a `scope_key` string such as
 * `healthid:2026:01` or `token:doctor:14:2026-09-16`.
 *
 * MUST be called with an open transaction connection (`conn`) so the row
 * lock is held for the lifetime of the surrounding business transaction
 * (e.g. "reserve next token" + "insert appointment" happen atomically).
 */

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {string} scopeKey
 * @returns {Promise<number>} the next value in the sequence (1-based)
 */
async function nextValue(conn, scopeKey) {
  // Ensure the row exists (idempotent).
  await conn.execute(
    'INSERT INTO sequence_counters (scope_key, current_value) VALUES (:scopeKey, 0) ' +
      'ON DUPLICATE KEY UPDATE scope_key = scope_key',
    { scopeKey }
  );

  // Lock the row for the duration of this transaction, then increment.
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

/** Zero-pads a number to `width` digits. */
function pad(num, width) {
  return String(num).padStart(width, '0');
}

module.exports = { nextValue, pad };
