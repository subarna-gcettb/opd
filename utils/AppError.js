class AppError extends Error {
  constructor(message, statusCode = 400, meta = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true; // safe to show `message` to the user
    this.meta = meta;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
