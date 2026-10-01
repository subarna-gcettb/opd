const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { notFoundHandler, statusFromError, safePublicMessage } = require('../middleware/errorHandler');
const AppError = require('../utils/AppError');
const bcrypt = require('bcryptjs');

test('404 handler returns JSON for API clients', async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', require('node:path').join(__dirname, '..', 'views'));
  app.set('layout', 'layouts/blank');
  app.use(notFoundHandler);
  const res = await request(app).get('/missing').set('Accept', 'application/json');
  assert.equal(res.status, 404);
  assert.equal(res.body.status, 404);
  assert.match(res.body.error, /not found/i);
});

test('404 handler returns the HTML error page for browsers', async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(notFoundHandler);
  const res = await request(app).get('/missing').set('Accept', 'text/html');
  assert.equal(res.status, 404);
  assert.match(res.text, /Page Not Found/i);
});

test('operational errors keep their public message', () => {
  const err = new AppError('Patient not found', 404);
  assert.equal(statusFromError(err), 404);
  assert.equal(safePublicMessage(err, 404), 'Patient not found');
});

test('unexpected errors never expose internal details in production-style messages', () => {
  const err = new Error('SQL password=super-secret /var/lib/mysql');
  assert.equal(statusFromError(err), 500);
  assert.equal(
    safePublicMessage(err, 500),
    'Something went wrong on our end. Please try again, and contact support if it persists.'
  );
});

test('migration runner contains no destructive DROP TABLE operation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrate.js'), 'utf8');
  assert.doesNotMatch(source, /DROP\s+TABLE/i);
  assert.match(source, /schema_migrations/);
});

test('branding uploads do not permit SVG files', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'upload.js'), 'utf8');
  assert.doesNotMatch(source, /['"]\.svg['"]/);
});

test('production dependency floor is hardened', () => {
  const pkg = require('../package.json');
  assert.match(pkg.dependencies.express, /4\.22/);
  assert.match(pkg.dependencies.multer, /2\.4/);
  assert.match(pkg.dependencies.helmet, /8\.3/);
});


test('bcryptjs can hash and verify passwords with the configured cost', async () => {
  const password = 'Strong-Test-Password-2026!';
  const hash = await bcrypt.hash(password, 12);
  assert.equal(await bcrypt.compare(password, hash), true);
  assert.equal(await bcrypt.compare('wrong-password', hash), false);
});
