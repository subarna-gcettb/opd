const sequenceService = require('./sequenceService');

/**
 * Health ID format:  YY BB SSSSSSS  (11 digits total)
 *   YY = last 2 digits of the year of FIRST registration (never changes later)
 *   BB = branch code (2 digits, from branches.code) of the registering branch
 *   SSSSSSS = 7-digit sequence, unique within (year, branch)
 *
 * The Health ID is permanent: it never changes when the patient's doctor,
 * branch of visit, or department changes. It is generated exactly once,
 * at first registration.
 *
 * Concurrency safety:
 *  1. Application level — `sequenceService.nextValue` takes a row lock
 *     (`SELECT ... FOR UPDATE`) on the `sequence_counters` row for this
 *     (year, branch), serializing concurrent registrations at the same
 *     branch.
 *  2. Database level (final backstop) — `patients.health_id` has a UNIQUE
 *     constraint. If a race condition ever produced a duplicate, the
 *     INSERT into `patients` fails and the caller must retry generation.
 *     Correctness therefore never depends on the row lock alone.
 *
 * MUST be called inside the same transaction that inserts the patient row,
 * so the sequence reservation and the patient creation succeed or fail
 * together.
 */

/**
 * @param {import('mysql2/promise').PoolConnection} conn - open transaction connection
 * @param {string} branchCode - 2-character branch code, e.g. '01'
 * @param {Date} [registeredAt] - defaults to now
 * @returns {Promise<string>} an 11-digit Health ID
 */
async function generateHealthId(conn, branchCode, registeredAt = new Date()) {
  const yy = String(registeredAt.getFullYear()).slice(-2);
  const bb = String(branchCode).padStart(2, '0').slice(-2);
  const scopeKey = `healthid:${yy}:${bb}`;

  const seq = await sequenceService.nextValue(conn, scopeKey);
  const sssssss = sequenceService.pad(seq, 7);

  return `${yy}${bb}${sssssss}`;
}

module.exports = { generateHealthId };
