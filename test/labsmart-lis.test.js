'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateFormula } = require('../utils/labFormula');
const ejs = require('ejs');

test('lab formulas support safe arithmetic and parameter-code references', () => {
  assert.equal(evaluateFormula('LDL + HDL + VLDL', { LDL: 100, HDL: 40, VLDL: 20 }), 160);
  assert.equal(evaluateFormula('(TC - HDL) / 5', { TC: 200, HDL: 40 }), 32);
  assert.equal(evaluateFormula('2^3 + -1', {}), 7);
});

test('lab formulas reject JavaScript, unknown inputs and division by zero', () => {
  assert.throws(() => evaluateFormula('process.exit()', {}));
  assert.throws(() => evaluateFormula('LDL + HDL', { LDL: 10 }));
  assert.throws(() => evaluateFormula('10 / (2 - 2)', {}));
});

test('LabSmart-inspired LIS features are connected to migrations, routes and services', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'database/migrations/1012_labsmart_lis_features.sql'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes/labRoutes.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'services/labSmartService.js'), 'utf8');
  const labService = fs.readFileSync(path.join(root, 'services/labService.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_test_packages/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_order_payments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_expenses/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_share_tokens/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_settings/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_tpa_claims/);
  assert.match(routes, /\/packages/);
  assert.match(routes, /\/accounting/);
  assert.match(routes, /\/export\.csv/);
  assert.match(routes, /\/share\/email/);
  assert.match(routes, /\/review-builder/);
  assert.match(routes, /\/tpa-claim/);
  assert.match(routes, /\/home-collection\/assign/);
  assert.match(routes, /\/workers/);
  assert.match(service, /crypto\.createHash\('sha256'\)/);
  assert.match(service, /function csvCell/);
  assert.match(labService, /evaluateFormula\(p\.formula_expression,byCode\)/);
  assert.match(labService, /lab_reference_ranges WHERE parameter_id/);
  assert.match(labService, /home_collection_status=\\'COLLECTED\\'/);
  assert.match(service, /LAB_TPA_CLAIM_CREATED/);
  assert.match(service, /LAB_HOME_COLLECTION_ASSIGNMENT_UPDATED/);
  assert.match(app, /routes\/labPublicRoutes/);
});

test('all changed LIS EJS views compile successfully', () => {
  const root = path.join(__dirname, '..');
  const views = [
    'views/lab/packages.ejs',
    'views/lab/package-form.ejs',
    'views/lab/accounting.ejs',
    'views/lab/settings.ejs',
    'views/lab/review-builder.ejs',
    'views/lab/staff.ejs',
    'views/lab/share.ejs',
    'views/lab/public-order.ejs',
    'views/lab/new-order.ejs',
    'views/lab/order-detail.ejs',
    'views/lab/result.ejs',
    'views/lab/test-form.ejs',
    'views/patient-portal/lab.ejs',
    'views/print/lab-report.ejs',
    'views/print/lab-bill.ejs',
    'views/print/lab-sample-label.ejs'
  ];
  for (const relative of views) {
    const filename = path.join(root, relative);
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(filename, 'utf8'), { filename }), relative);
  }
});
