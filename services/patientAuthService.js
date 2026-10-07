const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../config/database');
const authConfig = require('../config/auth');
const auditService = require('./auditService');
const patientService = require('./patientService');
const emailService = require('./emailService');
const AppError = require('../utils/AppError');

function makeOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function normalizeOtp(otp) {
  const value = String(otp ?? '').trim().replace(/[\u00a0\s-]/g, '');
  return /^\d{6}$/.test(value) ? value : null;
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

async function issueOtp(purpose, email, payload = null) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new AppError('Email address is required', 422);

  const otp = makeOtp();
  const otpHash = hashOtp(otp);
  const expiryMinutes = authConfig.otpExpiryMinutes;
  const cooldownSeconds = authConfig.otpResendCooldownSeconds;

  // Do not invalidate a working code before we know that the replacement
  // email was actually accepted by the SMTP server.
  const [[recent]] = await pool.execute(
    `SELECT id, created_at
     FROM auth_otps
     WHERE purpose = :purpose
       AND email = :email
       AND consumed_at IS NULL
       AND created_at > DATE_SUB(NOW(), INTERVAL ${Math.max(1, cooldownSeconds)} SECOND)
     ORDER BY id DESC
     LIMIT 1`,
    { purpose, email: normalized }
  );
  if (recent) {
    throw new AppError('A verification code was sent recently. Please wait before requesting another code.', 429);
  }

  const [insertResult] = await pool.execute(
    `INSERT INTO auth_otps (purpose, email, otp_hash, payload, expires_at)
     VALUES (:purpose, :email, :otpHash, :payload, DATE_ADD(NOW(), INTERVAL ${Math.max(1, expiryMinutes)} MINUTE))`,
    { purpose, email: normalized, otpHash, payload: payload ? JSON.stringify(payload) : null }
  );

  const otpId = insertResult.insertId;
  const result = await emailService.sendMail({
    to: normalized,
    subject: 'Chhayabithi HMS — Your verification code',
    html: `<p>Your Chhayabithi HMS verification code is <strong style="font-size:24px;letter-spacing:4px;">${otp}</strong>.</p><p>This code expires in ${Math.max(1, expiryMinutes)} minutes. If you did not request it, you can ignore this email.</p>`,
    text: `Your Chhayabithi HMS verification code is ${otp}. It expires in ${Math.max(1, expiryMinutes)} minutes.`
  });

  if (!result.sent) {
    await pool.execute('DELETE FROM auth_otps WHERE id = :id AND consumed_at IS NULL', { id: otpId }).catch(() => {});
    throw new AppError(
      result.reason === 'smtp_disabled'
        ? 'Email service is not configured. Please contact the hospital administrator.'
        : 'We could not send the verification email. Please try again in a moment.',
      503
    );
  }

  // Only the successfully delivered code remains valid.
  await pool.execute(
    'UPDATE auth_otps SET consumed_at = NOW() WHERE purpose = :purpose AND email = :email AND consumed_at IS NULL AND id <> :id',
    { purpose, email: normalized, id: otpId }
  );

  return { sent: true, expiresInMinutes: Math.max(1, expiryMinutes) };
}

async function consumeOtp(purpose, email, otp) {
  const normalized = String(email || '').trim().toLowerCase();
  const normalizedOtp = normalizeOtp(otp);
  if (!normalizedOtp) throw new AppError('Enter the 6-digit verification code.', 422);

  const [rows] = await pool.execute(
    `SELECT * FROM auth_otps
     WHERE purpose = :purpose AND email = :email AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    { purpose, email: normalized }
  );
  if (!rows.length) throw new AppError('The verification code is invalid or expired', 422);

  const record = rows[0];
  if (record.attempts >= authConfig.otpMaxAttempts) throw new AppError('Too many verification attempts. Request a new code.', 429);

  const storedHash = String(record.otp_hash || '').trim().toLowerCase();
  const suppliedHash = hashOtp(normalizedOtp);
  const valid = /^[a-f0-9]{64}$/.test(storedHash)
    && crypto.timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      Buffer.from(suppliedHash, 'hex')
    );

  if (!valid) {
    await pool.execute('UPDATE auth_otps SET attempts = attempts + 1 WHERE id = :id', { id: record.id });
    throw new AppError('The verification code is incorrect', 422);
  }

  await pool.execute('UPDATE auth_otps SET consumed_at = NOW() WHERE id = :id', { id: record.id });
  return record;
}

async function createPatientFromSignup(payload) {
  const email = String(payload.email).trim().toLowerCase();
  const [[existing]] = await pool.execute(
    'SELECT id FROM users WHERE email = :email AND deleted_at IS NULL LIMIT 1',
    { email }
  );
  if (existing) throw new AppError('An account with this email already exists. Please sign in.', 409);

  const [[branch]] = await pool.execute(
    'SELECT id FROM branches WHERE is_active = 1 ORDER BY id LIMIT 1'
  );
  if (!branch) throw new AppError('No active hospital branch is configured', 500);

  const patient = await patientService.registerPatient({
    branchId: branch.id,
    name: payload.name,
    fatherName: payload.fatherName,
    husbandName: payload.husbandName,
    gender: payload.gender || 'Other',
    dob: payload.dob || null,
    ageYears: payload.ageYears || null,
    mobile: payload.mobile,
    email,
    altMobile: payload.altMobile,
    address: payload.address,
    villageTown: payload.villageTown,
    policeStation: payload.policeStation,
    district: payload.district,
    state: payload.state || 'West Bengal',
    pinCode: payload.pinCode
  }, null);

  const hash = payload.passwordHash || await bcrypt.hash(payload.password, authConfig.bcryptRounds);

  await withTransaction(async (conn) => {
    const [userResult] = await conn.execute(
      `INSERT INTO users
       (branch_id, patient_id, name, email, mobile, password_hash, must_reset_password, is_active)
       VALUES (:branchId, :patientId, :name, :email, :mobile, :passwordHash, 0, 1)`,
      {
        branchId: branch.id,
        patientId: patient.id,
        name: payload.name,
        email,
        mobile: payload.mobile,
        passwordHash: hash
      }
    );
    const userId = userResult.insertId;
    const [[role]] = await conn.execute("SELECT id FROM roles WHERE code = 'PATIENT'");
    if (!role) throw new AppError('Patient role is not configured', 500);
    await conn.execute('INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)', {
      userId,
      roleId: role.id
    });
    await auditService.log({
      userId,
      action: 'PATIENT_SIGNUP',
      entity: 'user',
      entityId: userId,
      newValue: { patientId: patient.id, email }
    }, conn);
  });

  return patient;
}

async function findPatientUser(identifier) {
  const key = String(identifier || '').trim();
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.email, u.mobile, u.password_hash, u.is_active, u.patient_id, p.health_id
     FROM users u
     JOIN patients p ON p.id = u.patient_id
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id AND r.code = 'PATIENT'
     WHERE u.deleted_at IS NULL AND p.deleted_at IS NULL
       AND (LOWER(u.email) = LOWER(:key) OR u.mobile = :key OR p.health_id = :key)
     LIMIT 1`,
    { key }
  );
  return rows[0] || null;
}

module.exports = { issueOtp, consumeOtp, createPatientFromSignup, findPatientUser };
