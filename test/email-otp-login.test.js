const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('email OTP login uses a dedicated CSRF-protected verification route', () => {
  const routes = fs.readFileSync(path.join(root, 'routes/authRoutes.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views/auth/login.ejs'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers/emailOtpController.js'), 'utf8');

  assert.match(routes, /router\.post\('\/login\/request-otp', csrfProtection, emailOtpController\.requestLoginOtp\)/);
  assert.match(routes, /router\.post\('\/login\/verify-otp', csrfProtection, emailOtpController\.verifyLoginOtp\)/);
  assert.match(view, /action="\/auth\/login\/verify-otp"/);
  assert.match(view, /name="_csrf" value="<%= csrfToken %>"/);
  assert.doesNotMatch(view, /action="\/auth\/login"[^>]*>[^]*name="otp"/);
  assert.match(controller, /req\.session\.loginOtpEmail/);
});

test('email OTP login does not put the email address in the redirect URL', () => {
  const controller = fs.readFileSync(path.join(root, 'controllers/emailOtpController.js'), 'utf8');
  assert.doesNotMatch(controller, /encodeURIComponent\(email\)/);
  assert.match(controller, /redirectLogin\(req, res, '\?otp=1'\)/);
});

test('OTP issuance only invalidates older codes after email delivery succeeds', () => {
  const service = fs.readFileSync(path.join(root, 'services/patientAuthService.js'), 'utf8');
  const sendPos = service.indexOf('await emailService.sendMail');
  const invalidatePos = service.indexOf('Only the successfully delivered code remains valid.');
  assert.ok(sendPos >= 0);
  assert.ok(invalidatePos > sendPos);
  assert.match(service, /DELETE FROM auth_otps WHERE id = :id AND consumed_at IS NULL/);
  assert.match(service, /OTP_RESEND_COOLDOWN_SECONDS/);
});
