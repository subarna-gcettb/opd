/**
 * Wraps an async Express route/middleware handler so rejected promises
 * are forwarded to next(err) instead of crashing the process.
 */
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
