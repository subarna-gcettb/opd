const adminService = require('../services/adminService');
const emailService = require('../services/emailService');
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');

// ---- USERS ----
async function listUsers(req, res, next) {
  try {
    const users = await adminService.listUsers();
    const roles = await adminService.listRoles();
    const branches = await adminService.listBranches();
    res.render('admin/users', { title: 'Users', users, roles, branches });
  } catch (err) { next(err); }
}

async function createUser(req, res, next) {
  try {
    await adminService.createUser(req.body, req.user.id);
    req.flash('success', 'User created. They must change their temporary password on first login.');
    emailService.notifyAccountCreated({
      to: req.body.email, name: req.body.name, email: req.body.email,
      temporaryPassword: req.body.temporaryPassword
    }).catch(() => {});
    res.redirect('/admin/users');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/admin/users');
    }
    next(err);
  }
}

async function toggleUserActive(req, res, next) {
  try {
    await adminService.setUserActive(req.params.id, req.body.isActive === '1', req.user.id);
    req.flash('success', 'User status updated.');
    res.redirect('/admin/users');
  } catch (err) { next(err); }
}

async function resetPassword(req, res, next) {
  try {
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw new AppError('Password must be at least 12 characters and include uppercase, lowercase, and a number.', 422);
    }
    await adminService.resetUserPassword(req.params.id, newPassword, req.user.id);
    req.flash('success', 'Password reset. The user must set a new password on next login.');
    notifyPasswordReset(req.params.id, newPassword).catch(() => {});
    res.redirect('/admin/users');
  } catch (err) { next(err); }
}

async function notifyPasswordReset(userId, newPassword) {
  const [[row]] = await pool.execute('SELECT name, email FROM users WHERE id = :id', { id: userId });
  if (!row) return;
  await emailService.notifyPasswordReset({ to: row.email, name: row.name, temporaryPassword: newPassword });
}

async function updateRoles(req, res, next) {
  try {
    await adminService.updateUserRoles(req.params.id, req.body.roleIds, req.user.id);
    req.flash('success', 'Roles updated.');
    res.redirect('/admin/users');
  } catch (err) { next(err); }
}

// ---- BRANCHES ----
async function listBranches(req, res, next) {
  try {
    const branches = await adminService.listBranches();
    res.render('admin/branches', { title: 'Branches', branches });
  } catch (err) { next(err); }
}
async function createBranch(req, res, next) {
  try {
    await adminService.createBranch(req.body, req.user.id);
    req.flash('success', 'Branch created.');
    res.redirect('/admin/branches');
  } catch (err) {
    if (err instanceof AppError) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/admin/branches');
    }
    next(err);
  }
}
async function updateBranch(req, res, next) {
  try {
    await adminService.updateBranch(req.params.id, req.body, req.user.id);
    req.flash('success', 'Branch updated.');
    res.redirect('/admin/branches');
  } catch (err) { next(err); }
}

// ---- DEPARTMENTS ----
async function listDepartments(req, res, next) {
  try {
    const departments = await adminService.listDepartments();
    res.render('admin/departments', { title: 'Departments', departments });
  } catch (err) { next(err); }
}
async function createDepartment(req, res, next) {
  try {
    await adminService.createDepartment(req.body.name, req.user.id);
    req.flash('success', 'Department added.');
    res.redirect('/admin/departments');
  } catch (err) { next(err); }
}
async function toggleDepartmentActive(req, res, next) {
  try {
    await adminService.setDepartmentActive(req.params.id, req.body.isActive === '1', req.user.id);
    req.flash('success', 'Department updated.');
    res.redirect('/admin/departments');
  } catch (err) { next(err); }
}

// ---- AUDIT LOGS ----
async function auditLogs(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const data = await adminService.listAuditLogs({
      entity: req.query.entity || null, userId: req.query.userId || null, page, pageSize: 50
    });
    const [users] = await pool.execute('SELECT id, name FROM users WHERE deleted_at IS NULL ORDER BY name');
    res.render('admin/audit-logs', {
      title: 'Audit Logs', ...data, users,
      filters: { entity: req.query.entity || '', userId: req.query.userId || '' },
      totalPages: Math.ceil(data.total / data.pageSize)
    });
  } catch (err) { next(err); }
}

// ---- SITE SETTINGS ----
const settingsService = require('../services/settingsService');
const { publicUrlFor } = require('../utils/upload');

async function showSettings(req, res, next) {
  try {
    const settings = await settingsService.getSettings();
    res.render('admin/settings', { title: 'Site Settings', settings });
  } catch (err) { next(err); }
}

async function updateSettings(req, res, next) {
  try {
    // Checkbox forms may submit a scalar when unchecked and an array when
    // a hidden fallback plus the checked value are both present.
    const hasEnabledValue = (value) => Array.isArray(value) ? value.includes('1') : value === '1';

    const values = {
      hospital_name: req.body.hospital_name,
      hospital_tagline: req.body.hospital_tagline,
      contact_phone: req.body.contact_phone,
      contact_email: req.body.contact_email,
      contact_address: req.body.contact_address,
      seo_title: req.body.seo_title,
      seo_description: req.body.seo_description,
      seo_keywords: req.body.seo_keywords,
      live_opd_show_names: hasEnabledValue(req.body.live_opd_show_names) ? '1' : '0',
      maintenance_mode: hasEnabledValue(req.body.maintenance_mode) ? '1' : '0'
    };

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) values.logo_path = publicUrlFor(req.files.logo[0].filename);
      if (req.files.favicon && req.files.favicon[0]) values.favicon_path = publicUrlFor(req.files.favicon[0].filename);
      if (req.files.og_image && req.files.og_image[0]) values.og_image_path = publicUrlFor(req.files.og_image[0].filename);
    }

    await settingsService.updateSettings(values, req.user.id);
    req.flash('success', values.maintenance_mode === '1'
      ? 'Maintenance mode enabled. Only Super Admin can access the site.'
      : 'Site settings updated. Maintenance mode is disabled.');
    res.redirect('/admin/settings');
  } catch (err) {
    if (err instanceof AppError || err.message.includes('images are allowed')) {
      req.flash('errors', [{ message: err.message }]);
      return res.redirect('/admin/settings');
    }
    next(err);
  }
}

module.exports = {
  listUsers, createUser, toggleUserActive, resetPassword, updateRoles,
  listBranches, createBranch, updateBranch,
  listDepartments, createDepartment, toggleDepartmentActive,
  auditLogs, showSettings, updateSettings
};
