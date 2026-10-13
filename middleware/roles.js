const AppError = require('../utils/AppError');

/**
 * requirePermission('discount.approve') -> middleware that 403s unless
 * the logged-in user's roles grant that permission.
 *
 * Deliberately permission-based, not role-based: granting ADMIN the
 * ability to approve discounts later is a data change (role_permissions
 * row) in seed/admin UI, not a code change here.
 */
function requirePermission(...permissionCodes) {
  return function (req, res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const has = permissionCodes.some((code) => permissions.includes(code));
    if (!has) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
}

/**
 * Allows a permission OR a narrowly-scoped role to use an endpoint.
 * Use for read-only booking lookups where role provisioning may lag behind
 * application code. Mutating booking routes must still validate permissions
 * and enforce their own resource/branch scope.
 */
function requirePermissionOrRole(permissionCodes = [], roleCodes = []) {
  return function (req, res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
    if (permissionCodes.some((code) => permissions.includes(code)) ||
        roleCodes.some((code) => roles.includes(code))) {
      return next();
    }
    return next(new AppError('You do not have permission to perform this action', 403));
  };
}

/** requireRole('SUPER_ADMIN', 'ADMIN') -> allow if user holds any of these roles. */
function requireRole(...roleCodes) {
  return function (req, res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
    const has = roleCodes.some((code) => roles.includes(code));
    if (!has) {
      return next(new AppError('You do not have access to this section', 403));
    }
    next();
  };
}

module.exports = { requirePermission, requirePermissionOrRole, requireRole };
