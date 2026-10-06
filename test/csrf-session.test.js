const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-csrf-regression';
process.env.CSRF_SECRET = 'test-csrf-secret-for-csrf-regression';

const { csrfProtection, exposeCsrfToken } = require('../middleware/csrf');

test('anonymous GET session is persisted so OTP POST keeps the same session-bound CSRF token', async () => {
  const app = express();

  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  }));
  app.use(cookieParser());
  app.use(exposeCsrfToken);

  app.get('/auth/login', (req, res) => {
    res.type('html').send('<form><input name="_csrf" value="' + res.locals.csrfToken + '"></form>');
  });

  app.post('/auth/login/request-otp', csrfProtection, (req, res) => {
    res.status(204).end();
  });

  const agent = request.agent(app);
  const page = await agent.get('/auth/login').expect(200);
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)?.[1];

  assert.ok(token, 'GET must expose a CSRF token');
  assert.match(page.headers['set-cookie'].join('; '), /connect.sid=/);

  await agent
    .post('/auth/login/request-otp')
    .type('form')
    .send({ email: 'patient@example.com', _csrf: token })
    .expect(204);
});
