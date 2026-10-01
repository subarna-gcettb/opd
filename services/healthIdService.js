const sequenceService = require('./sequenceService');

/** Health ID format: YY BB SSSSSSS (11 digits total). */
async function generateHealthId(conn, branchCode, registeredAt = new Date()) {
  const yy = String(registeredAt.getFullYear()).slice(-2);
  const bb = String(branchCode).padStart(2, '0').slice(-2);
  const scopeKey = `healthid:${yy}:${bb}`;
  const prefix = `${yy}${bb}`;

  // Reconcile the counter with existing patients (imports/restores/manual resets)
  // before allocating the next value. The sequence row is locked by
  // ensureAtLeast() and remains locked until this registration commits.
  const [[row]] = await conn.execute(
    'SELECT COALESCE(MAX(CAST(SUBSTRING(health_id, 5, 7) AS UNSIGNED)), 0) AS max_sequence ' +
      'FROM patients WHERE health_id LIKE :prefixLike AND CHAR_LENGTH(health_id) = 11',
    { prefixLike: `${prefix}%` }
  );
  await sequenceService.ensureAtLeast(conn, scopeKey, Number(row.max_sequence) || 0);

  const seq = await sequenceService.nextValue(conn, scopeKey);
  return `${prefix}${sequenceService.pad(seq, 7)}`;
}

module.exports = { generateHealthId };
