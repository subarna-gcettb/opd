process.env.AADHAAR_ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex key
process.env.AADHAAR_HASH_SECRET = 'test-hash-secret';

const aadhaarUtil = require('../../utils/aadhaarUtil');

describe('aadhaarUtil', () => {
  const VALID_AADHAAR = '234567890123';

  test('isValid accepts a 12-digit number and rejects anything else', () => {
    expect(aadhaarUtil.isValid(VALID_AADHAAR)).toBe(true);
    expect(aadhaarUtil.isValid('12345')).toBe(false);
    expect(aadhaarUtil.isValid('12345678901a')).toBe(false);
    expect(aadhaarUtil.isValid('')).toBe(false);
  });

  test('encrypt/decrypt round-trips to the original value', () => {
    const { encrypted, iv } = aadhaarUtil.encrypt(VALID_AADHAAR);
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(Buffer.isBuffer(iv)).toBe(true);
    const decrypted = aadhaarUtil.decrypt(encrypted, iv);
    expect(decrypted).toBe(VALID_AADHAAR);
  });

  test('encrypting the same value twice produces different ciphertext (random IV)', () => {
    const first = aadhaarUtil.encrypt(VALID_AADHAAR);
    const second = aadhaarUtil.encrypt(VALID_AADHAAR);
    expect(first.encrypted.equals(second.encrypted)).toBe(false);
  });

  test('hash is deterministic for the same input (needed for duplicate detection)', () => {
    const h1 = aadhaarUtil.hash(VALID_AADHAAR);
    const h2 = aadhaarUtil.hash(VALID_AADHAAR);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 hex
  });

  test('hash differs for different Aadhaar numbers', () => {
    expect(aadhaarUtil.hash('111122223333')).not.toBe(aadhaarUtil.hash('444455556666'));
  });

  test('last4 extracts the trailing 4 digits', () => {
    expect(aadhaarUtil.last4(VALID_AADHAAR)).toBe('0123');
  });

  test('mask renders the standard masked display format', () => {
    expect(aadhaarUtil.mask('1234')).toBe('XXXX XXXX 1234');
    expect(aadhaarUtil.mask(null)).toBeNull();
  });

  test('normalize strips whitespace', () => {
    expect(aadhaarUtil.normalize('2345 6789 0123')).toBe('234567890123');
  });
});
