module.exports = {
  bcryptRounds: 12,

  // 32-byte hex key for AES-256-GCM Aadhaar encryption. Must be set in .env.
  aadhaarEncryptionKey: process.env.AADHAAR_ENCRYPTION_KEY,
  // Secret for HMAC-SHA256 Aadhaar hash (deterministic, used for dedup lookup only).
  aadhaarHashSecret: process.env.AADHAAR_HASH_SECRET,

  csrfSecret: process.env.CSRF_SECRET,

  // Login lockout policy
  maxFailedLoginAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000
};
