const bcrypt = require('bcrypt');
const { pool, withTransaction } = require('../config/database');
const authConfig = require('../config/auth');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

// ---------------------------------------------------------------- USERS

async function listUsers() {
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.email, u.mobile, u.is_active, u.must_reset_password, u.last_login_at,
            b.name AS branch_name,
            GROUP_CONCAT(r.code SEPARATOR ', ') AS roles
     FROM users u
     LEFT JOIN branches b ON b.id = u.branch_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.deleted_at IS NULL
     GROUP BY u.id, u.name, u.email, u.mobile, u.is_active, u.must_reset_password, u.last_login_at, b.name
     ORDER BY u.name`
  );
  return rows;
}

async function createUser(payload, actorUserId) {
  return withTransaction(async (conn) => {
    const email = payload.email.trim().toLowerCase();
    const [existing] = await conn.execute('SELECT id FROM users WHERE email = :email', { email });
    if (existing.length) throw new AppError('A user with this email already exists', 409);

    const passwordHash = await bcrypt.hash(payload.temporaryPassword, authConfig.bcryptRounds);
    const [result] = await conn.execute(
      `INSERT INTO users (branch_id, name, email, mobile, password_hash, must_reset_password, is_active)
       VALUES (:branchId, :name, :email, :mobile, :passwordHash, 1, 1)`,
      { branchId: payload.branchId || null, name: payload.name, email, mobile: payload.mobile || null, passwordHash }
    );
    const userId = result.insertId;

    const roleIds = [].concat(payload.roleIds || []);
    for (const roleId of roleIds) {
      await conn.execute('INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)', { userId, roleId });
    }

    await auditService.log(
      { userId: actorUserId, action: 'USER_CREATED', entity: 'user', entityId: userId, newValue: { email, roleIds } },
      conn
    );
    return { id: userId };
  });
}

async function setUserActive(userId, isActive, actorUserId) {
  await pool.execute('UPDATE users SET is_active = :isActive WHERE id = :id', { isActive: isActive ? 1 : 0, id: userId });
  await auditService.log({
    userId: actorUserId,
    action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    entity: 'user',
    entityId: userId
  });
}

async function resetUserPassword(userId, newPassword, actorUserId) {
  const hash = await bcrypt.hash(newPassword, authConfig.bcryptRounds);
  await pool.execute(
    'UPDATE users SET password_hash = :hash, must_reset_password = 1, failed_login_attempts = 0, locked_until = NULL WHERE id = :id',
    { hash, id: userId }
  );
  await auditService.log({ userId: actorUserId, action: 'PASSWORD_RESET_BY_ADMIN', entity: 'user', entityId: userId });
}

async function updateUserRoles(userId, roleIds, actorUserId) {
  return withTransaction(async (conn) => {
    await conn.execute('DELETE FROM user_roles WHERE user_id = :userId', { userId });
    for (const roleId of [].concat(roleIds || [])) {
      await conn.execute('INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)', { userId, roleId });
    }
    await auditService.log(
      { userId: actorUserId, action: 'USER_ROLES_UPDATED', entity: 'user', entityId: userId, newValue: { roleIds } },
      conn
    );
  });
}

// -------------------------------------------------------------- BRANCHES

async function listBranches() {
  const [rows] = await pool.execute('SELECT * FROM branches ORDER BY name');
  return rows;
}

async function createBranch(payload, actorUserId) {
  const [result] = await pool.execute(
    'INSERT INTO branches (code, name, address, phone, email, is_active) VALUES (:code, :name, :address, :phone, :email, 1)',
    { code: payload.code, name: payload.name, address: payload.address || null, phone: payload.phone || null, email: payload.email || null }
  );
  await auditService.log({ userId: actorUserId, action: 'BRANCH_CREATED', entity: 'branch', entityId: result.insertId, newValue: payload });
  return { id: result.insertId };
}

async function updateBranch(branchId, payload, actorUserId) {
  await pool.execute(
    'UPDATE branches SET name = :name, address = :address, phone = :phone, email = :email, is_active = :isActive WHERE id = :id',
    {
      name: payload.name,
      address: payload.address || null,
      phone: payload.phone || null,
      email: payload.email || null,
      isActive: payload.isActive ? 1 : 0,
      id: branchId
    }
  );
  await auditService.log({ userId: actorUserId, action: 'BRANCH_UPDATED', entity: 'branch', entityId: branchId, newValue: payload });
}

// ------------------------------------------------------------ DEPARTMENTS

async function listDepartments() {
  const [rows] = await pool.execute('SELECT * FROM departments ORDER BY name');
  return rows;
}

async function createDepartment(name, actorUserId) {
  const [result] = await pool.execute('INSERT INTO departments (name, is_active) VALUES (:name, 1)', { name });
  await auditService.log({ userId: actorUserId, action: 'DEPARTMENT_CREATED', entity: 'department', entityId: result.insertId, newValue: { name } });
  return { id: result.insertId };
}

async function setDepartmentActive(departmentId, isActive, actorUserId) {
  await pool.execute('UPDATE departments SET is_active = :isActive WHERE id = :id', { isActive: isActive ? 1 : 0, id: departmentId });
  await auditService.log({
    userId: actorUserId,
    action: isActive ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_DEACTIVATED',
    entity: 'department',
    entityId: departmentId
  });
}

// ------------------------------------------------------------- AUDIT LOGS

async function listAuditLogs({ entity = null, userId = null, page = 1, pageSize = 50 }) {
  const offset = (page - 1) * pageSize;
  // pool.query (not execute) — see note in patientService.searchPatients
  // re: mysql2's execute()+bound-LIMIT prepared-statement bug.
  const [rows] = await pool.query(
    `SELECT al.*, u.name AS user_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE (:entity IS NULL OR al.entity = :entity)
       AND (:userId IS NULL OR al.user_id = :userId)
     ORDER BY al.created_at DESC
     LIMIT :limit OFFSET :offset`,
    { entity, userId, limit: pageSize, offset }
  );
  const [[{ total }]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM audit_logs al WHERE (:entity IS NULL OR al.entity = :entity) AND (:userId IS NULL OR al.user_id = :userId)',
    { entity, userId }
  );
  return { rows, total, page, pageSize };
}

async function listRoles() {
  const [rows] = await pool.execute('SELECT * FROM roles ORDER BY id');
  return rows;
}

module.exports = {
  listUsers,
  createUser,
  setUserActive,
  resetUserPassword,
  updateUserRoles,
  listBranches,
  createBranch,
  updateBranch,
  listDepartments,
  createDepartment,
  setDepartmentActive,
  listAuditLogs,
  listRoles
};
