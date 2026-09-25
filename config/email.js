module.exports = {
  enabled: Boolean(process.env.SMTP_HOST),
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  fromName: process.env.SMTP_FROM_NAME || 'Chhayabithi HMS',
  fromEmail: process.env.SMTP_FROM_EMAIL || 'no-reply@chhayabithi.com'
};
