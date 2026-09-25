const { pool } = require('../config/database');

/**
 * Records an audit log entry. Accepts an optional open transaction
 * connection so the audit row commits atomically with the business
 * change it documents; falls back to the pool otherwise.
 *
 * @param {object} entry
 * @param {number|null} entry.userId
 * @param {string} entry.action     e.g. 'PATIENT_CREATED', 'DISCOUNT_APPROVED'
 * @param {string} entry.entity     e.g. 'patient', 'invoice'
 * @param {string|number} [entry.entityId]
 * @param {object} [entry.oldValue]
 * @param {object} [entry.newValue]
 * @param {string} [entry.ipAddress]
 * @param {import('mysql2/promise').PoolConnection} [conn]
 */
async function log(entry, conn = null) {
  const db = conn || pool;
  const {
    userId = null,
    action,
    entity,
    entityId = null,
    oldValue = null,
    newValue = null,
    ipAddress = null
  } = entry;

  // Defense in depth: never persist credential-looking fields even if a
  // caller accidentally included them.
  const scrub = (obj) => {
    if (!obj) return null;
    const clone = { ...obj };
    delete clone.password;
    delete clone.password_hash;
    delete clone.passwordHash;
    delete clone.aadhaar;
    delete clone.aadhaar_encrypted;
    return clone;
  };

  await db.execute(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_value, new_value, ip_address)
     VALUES (:userId, :action, :entity, :entityId, :oldValue, :newValue, :ipAddress)`,
    {
      userId,
      action,
      entity,
      entityId: entityId !== null ? String(entityId) : null,
      oldValue: oldValue ? JSON.stringify(scrub(oldValue)) : null,
      newValue: newValue ? JSON.stringify(scrub(newValue)) : null,
      ipAddress
    }
  );
}

module.exports = { log };
