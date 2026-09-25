const bcrypt = require('bcrypt');
const { pool, withTransaction } = require('../config/database');
const sequenceService = require('./sequenceService');
const auditService = require('./auditService');
const authConfig = require('../config/auth');
const AppError = require('../utils/AppError');

/** Doctor code format: DOC-BB-NNNN */
async function generateDoctorCode(conn, branchCode) {
  const bb = String(branchCode).padStart(2, '0').slice(-2);
  const seq = await sequenceService.nextValue(conn, `doctorcode:${bb}`);
  return `DOC${bb}${sequenceService.pad(seq, 4)}`;
}

/**
 * Creates a doctor: a login user account (role DOCTOR) plus the clinical
 * doctor profile, in one transaction. The doctor must change the
 * temporary password on first login.
 */
async function createDoctor(payload, actorUserId) {
  return withTransaction(async (conn) => {
    const [[branch]] = await conn.execute('SELECT code FROM branches WHERE id = :id AND is_active = 1', {
      id: payload.branchId
    });
    if (!branch) throw new AppError('Invalid branch', 422);

    const [existing] = await conn.execute('SELECT id FROM users WHERE email = :email LIMIT 1', {
      email: payload.email.trim().toLowerCase()
    });
    if (existing.length) throw new AppError('A user with this email already exists', 409);

    const passwordHash = await bcrypt.hash(payload.temporaryPassword, authConfig.bcryptRounds);

    const [userResult] = await conn.execute(
      `INSERT INTO users (branch_id, name, email, mobile, password_hash, must_reset_password, is_active)
       VALUES (:branchId, :name, :email, :mobile, :passwordHash, 1, 1)`,
      {
        branchId: payload.branchId,
        name: payload.name,
        email: payload.email.trim().toLowerCase(),
        mobile: payload.mobile || null,
        passwordHash
      }
    );
    const userId = userResult.insertId;

    const [[doctorRole]] = await conn.execute("SELECT id FROM roles WHERE code = 'DOCTOR'");
    await conn.execute('INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)', {
      userId,
      roleId: doctorRole.id
    });

    const doctorCode = await generateDoctorCode(conn, branch.code);

    const [docResult] = await conn.execute(
      `INSERT INTO doctors
        (user_id, doctor_code, gender, dob, mobile, email, address, professional_reg_number,
         qualification, specialisation, department_id, branch_id, experience_years, consultation_fee, joining_date)
       VALUES
        (:userId, :doctorCode, :gender, :dob, :mobile, :email, :address, :regNo,
         :qualification, :specialisation, :departmentId, :branchId, :experience, :fee, :joiningDate)`,
      {
        userId,
        doctorCode,
        gender: payload.gender || null,
        dob: payload.dob || null,
        mobile: payload.mobile || null,
        email: payload.email.trim().toLowerCase(),
        address: payload.address || null,
        regNo: payload.professionalRegNumber || null,
        qualification: payload.qualification || null,
        specialisation: payload.specialisation || null,
        departmentId: payload.departmentId || null,
        branchId: payload.branchId,
        experience: payload.experienceYears || null,
        fee: payload.consultationFee || 0,
        joiningDate: payload.joiningDate || null
      }
    );

    await auditService.log(
      {
        userId: actorUserId,
        action: 'DOCTOR_CREATED',
        entity: 'doctor',
        entityId: docResult.insertId,
        newValue: { doctorCode, name: payload.name, email: payload.email }
      },
      conn
    );

    return { id: docResult.insertId, doctorCode };
  });
}

async function updateDoctor(doctorId, payload, actorUserId) {
  return withTransaction(async (conn) => {
    const [[before]] = await conn.execute('SELECT * FROM doctors WHERE id = :id AND deleted_at IS NULL', {
      id: doctorId
    });
    if (!before) throw new AppError('Doctor not found', 404);

    await conn.execute(
      `UPDATE doctors SET gender = :gender, dob = :dob, mobile = :mobile, address = :address,
        professional_reg_number = :regNo, qualification = :qualification, specialisation = :specialisation,
        department_id = :departmentId, experience_years = :experience, consultation_fee = :fee,
        joining_date = :joiningDate, is_active = :isActive
       WHERE id = :id`,
      {
        gender: payload.gender || null,
        dob: payload.dob || null,
        mobile: payload.mobile || null,
        address: payload.address || null,
        regNo: payload.professionalRegNumber || null,
        qualification: payload.qualification || null,
        specialisation: payload.specialisation || null,
        departmentId: payload.departmentId || null,
        experience: payload.experienceYears || null,
        fee: payload.consultationFee || 0,
        joiningDate: payload.joiningDate || null,
        isActive: payload.isActive ? 1 : 0,
        id: doctorId
      }
    );

    if (payload.name) {
      await conn.execute('UPDATE users SET name = :name WHERE id = :userId', {
        name: payload.name,
        userId: before.user_id
      });
    }

    await auditService.log(
      {
        userId: actorUserId,
        action: 'DOCTOR_UPDATED',
        entity: 'doctor',
        entityId: doctorId,
        oldValue: { specialisation: before.specialisation, fee: before.consultation_fee, active: before.is_active },
        newValue: { specialisation: payload.specialisation, fee: payload.consultationFee, active: payload.isActive ? 1 : 0 }
      },
      conn
    );
  });
}

async function listDoctors({ branchId = null, departmentId = null, includeInactive = false } = {}) {
  const [rows] = await pool.execute(
    `SELECT d.id, d.doctor_code, u.name, d.specialisation, d.qualification, d.consultation_fee,
            d.is_active, dept.name AS department_name, b.name AS branch_name
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN departments dept ON dept.id = d.department_id
     JOIN branches b ON b.id = d.branch_id
     WHERE d.deleted_at IS NULL
       AND (:includeInactive = 1 OR d.is_active = 1)
       AND (:branchId IS NULL OR d.branch_id = :branchId)
       AND (:departmentId IS NULL OR d.department_id = :departmentId)
     ORDER BY u.name`,
    { includeInactive: includeInactive ? 1 : 0, branchId, departmentId }
  );
  return rows;
}

async function getDoctor(doctorId) {
  const [[doctor]] = await pool.execute(
    `SELECT d.*, u.name, u.email AS login_email, u.is_active AS user_active,
            dept.name AS department_name, b.name AS branch_name, b.code AS branch_code
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN departments dept ON dept.id = d.department_id
     JOIN branches b ON b.id = d.branch_id
     WHERE d.id = :id AND d.deleted_at IS NULL`,
    { id: doctorId }
  );
  if (!doctor) return null;

  const [templates] = await pool.execute(
    'SELECT * FROM doctor_schedule_templates WHERE doctor_id = :id ORDER BY weekday, start_time',
    { id: doctorId }
  );
  const [exceptions] = await pool.execute(
    'SELECT * FROM doctor_schedule_exceptions WHERE doctor_id = :id AND exception_date >= CURDATE() ORDER BY exception_date',
    { id: doctorId }
  );
  return { doctor, templates, exceptions };
}

async function addScheduleTemplate(doctorId, payload, actorUserId) {
  await pool.execute(
    `INSERT INTO doctor_schedule_templates
      (doctor_id, weekday, start_time, end_time, slot_duration_minutes, max_patients_per_slot)
     VALUES (:doctorId, :weekday, :startTime, :endTime, :slotDuration, :maxPatients)`,
    {
      doctorId,
      weekday: payload.weekday,
      startTime: payload.startTime,
      endTime: payload.endTime,
      slotDuration: payload.slotDuration || 15,
      maxPatients: payload.maxPatients || 1
    }
  );
  await auditService.log({
    userId: actorUserId,
    action: 'DOCTOR_SCHEDULE_UPDATED',
    entity: 'doctor',
    entityId: doctorId,
    newValue: payload
  });
}

async function deleteScheduleTemplate(doctorId, templateId, actorUserId) {
  await pool.execute('DELETE FROM doctor_schedule_templates WHERE id = :id AND doctor_id = :doctorId', {
    id: templateId,
    doctorId
  });
  await auditService.log({
    userId: actorUserId,
    action: 'DOCTOR_SCHEDULE_UPDATED',
    entity: 'doctor',
    entityId: doctorId,
    oldValue: { removedTemplateId: templateId }
  });
}

async function addScheduleException(doctorId, payload, actorUserId) {
  await pool.execute(
    `INSERT INTO doctor_schedule_exceptions (doctor_id, exception_date, is_unavailable, start_time, end_time, reason)
     VALUES (:doctorId, :date, :isUnavailable, :startTime, :endTime, :reason)
     ON DUPLICATE KEY UPDATE is_unavailable = VALUES(is_unavailable), start_time = VALUES(start_time),
       end_time = VALUES(end_time), reason = VALUES(reason)`,
    {
      doctorId,
      date: payload.date,
      isUnavailable: payload.isUnavailable ? 1 : 0,
      startTime: payload.startTime || null,
      endTime: payload.endTime || null,
      reason: payload.reason || null
    }
  );
  await auditService.log({
    userId: actorUserId,
    action: 'DOCTOR_SCHEDULE_EXCEPTION',
    entity: 'doctor',
    entityId: doctorId,
    newValue: payload
  });
}

async function getOwnProfile(doctorId) {
  const [[doctor]] = await pool.execute(
    `SELECT d.*, u.name, u.email AS login_email
     FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE d.id = :id AND d.deleted_at IS NULL`, { id: doctorId }
  );
  return doctor || null;
}

async function updateOwnProfile(doctorId, userId, payload) {
  return withTransaction(async (conn) => {
    const [[doctor]] = await conn.execute(
      'SELECT id, user_id FROM doctors WHERE id = :doctorId AND user_id = :userId AND deleted_at IS NULL FOR UPDATE',
      { doctorId, userId }
    );
    if (!doctor) throw new AppError('Doctor profile not found', 404);
    await conn.execute(
      `UPDATE doctors SET gender=:gender, dob=:dob, mobile=:mobile, address=:address,
        professional_reg_number=:regNo, qualification=:qualification, specialisation=:specialisation
       WHERE id=:doctorId`,
      { doctorId, gender: payload.gender || null, dob: payload.dob || null, mobile: payload.mobile || null,
        address: payload.address || null, regNo: payload.professionalRegNumber || null,
        qualification: payload.qualification || null, specialisation: payload.specialisation || null }
    );
    if (payload.name && payload.name.trim()) {
      await conn.execute('UPDATE users SET name=:name WHERE id=:userId', { name: payload.name.trim(), userId });
    }
    await auditService.log({
      userId, action: 'DOCTOR_SELF_PROFILE_UPDATED', entity: 'doctor', entityId: doctorId,
      newValue: { name: payload.name, mobile: payload.mobile, qualification: payload.qualification, specialisation: payload.specialisation }
    }, conn);
  });
}

module.exports = {
  createDoctor,
  updateDoctor,
  listDoctors,
  getDoctor,
  addScheduleTemplate,
  deleteScheduleTemplate,
  addScheduleException,
  getOwnProfile,
  updateOwnProfile
};
