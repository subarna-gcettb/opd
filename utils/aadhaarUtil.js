const crypto = require('crypto');
const authConfig = require('../config/auth');

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = authConfig.aadhaarEncryptionKey;
  if (!hex || hex.length !== 64) {
    throw new Error('AADHAAR_ENCRYPTION_KEY must be a 32-byte (64 hex char) key');
  }
  return Buffer.from(hex, 'hex');
}

function normalize(aadhaar) {
  return String(aadhaar || '').replace(/\s+/g, '');
}

/**
 * Encrypts a raw Aadhaar number. Returns { encrypted, iv } as Buffers
 * suitable for VARBINARY columns. The auth tag is appended to `encrypted`.
 */
function encrypt(aadhaar) {
  const clean = normalize(aadhaar);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted: Buffer.concat([encrypted, authTag]), iv };
}

function decrypt(encryptedWithTag, iv) {
  const authTag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
  const encrypted = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** Deterministic HMAC — used ONLY for server-side duplicate-detection lookups. */
function hash(aadhaar) {
  const clean = normalize(aadhaar);
  return crypto
    .createHmac('sha256', authConfig.aadhaarHashSecret)
    .update(clean)
    .digest('hex');
}

function last4(aadhaar) {
  const clean = normalize(aadhaar);
  return clean.slice(-4);
}

function mask(last4Digits) {
  return last4Digits ? `XXXX XXXX ${last4Digits}` : null;
}

function isValid(aadhaar) {
  return /^\d{12}$/.test(normalize(aadhaar));
}

module.exports = { encrypt, decrypt, hash, last4, mask, isValid, normalize };
