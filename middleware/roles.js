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
    const has = permissionCodes.some((code) => req.user.permissions.includes(code));
    if (!has) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
}

/** requireRole('SUPER_ADMIN', 'ADMIN') -> allow if user holds any of these roles. */
function requireRole(...roleCodes) {
  return function (req, res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    const has = roleCodes.some((code) => req.user.roles.includes(code));
    if (!has) {
      return next(new AppError('You do not have access to this section', 403));
    }
    next();
  };
}

module.exports = { requirePermission, requireRole };
