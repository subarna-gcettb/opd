'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calculator = require('../utils/pregnancyCalculator');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('pregnancy calculator handles date-only inputs and rejects invalid or future LMP dates', () => {
  const lmp = calculator.calculatePregnancy('2026-01-01', new Date(2026, 0, 8));
  assert.equal(lmp.gestationalAgeWeeks, 1);
  assert.equal(lmp.gestationalAgeDays, 0);
  assert.equal(lmp.estimatedDueDate, '2026-10-08');
  assert.equal(calculator.calculatePregnancy('2026-02-30', new Date(2026, 2, 1)), null);
  assert.equal(calculator.calculatePregnancy('2026-01-09', new Date(2026, 0, 8)), null);
});

test('USG gestational-age calculation rejects missing weeks and invalid day ranges', () => {
  assert.equal(calculator.calculatePregnancyFromUltrasound('2026-10-08', '', 0, new Date(2026, 9, 8)), null);
  assert.equal(calculator.calculatePregnancyFromUltrasound('2026-10-08', null, 0, new Date(2026, 9, 8)), null);
  assert.equal(calculator.calculatePregnancyFromUltrasound('2026-10-08', 12, 7, new Date(2026, 9, 8)), null);
  const valid = calculator.calculatePregnancyFromUltrasound('2026-10-08', 12, 3, new Date(2026, 9, 8));
  assert.equal(valid.gestationalAgeWeeks, 12);
  assert.equal(valid.gestationalAgeDays, 3);
  assert.equal(valid.estimatedDueDate, '2027-04-19');
});

test('USG EDD and conception-based dating return a consistent EDD', () => {
  const usgEdd = calculator.calculatePregnancyFromUltrasoundEdd('2027-04-19', new Date(2026, 9, 8));
  const conception = calculator.calculatePregnancyFromReference('2026-07-27', 'CONCEPTION', new Date(2026, 9, 8));
  assert.equal(usgEdd.estimatedDueDate, '2027-04-19');
  assert.equal(conception.estimatedDueDate, '2027-04-19');
});

test('shared pregnancy assessment initializes every widget and formats dates as dd-mm-yyyy', () => {
  const source = read('views/partials/pregnancy-assessment.ejs');
  assert.match(source, /querySelectorAll\('\[data-pregnancy-widget\]'\)/);
  assert.match(source, /dataset\.pregnancyInitialized/);
  assert.doesNotMatch(source, /window\.__pregnancyWidgetInitialized/);
  assert.match(source, /usgWeeks\.value\.trim\(\) === ''/);
  assert.match(source, /padStart\(2, '0'\).*getFullYear/s);
  assert.match(source, /conceptionInput\.value = ''/);
  assert.match(source, /referenceInput\.value = ''/);
});

test('OPD booking validates the correct form, uses appointment date for dating, and clears stale USG values', () => {
  const source = read('views/opd/book.ejs');
  assert.match(source, /pregnancyStatus\?\.closest\('form'\)\?\.addEventListener\('submit'/);
  assert.doesNotMatch(source, /document\.querySelector\('form'\)\?\.addEventListener\('submit'/);
  assert.match(source, /const selectedAppointmentDate = bookingParseDate\(dateInput\.value\)/);
  assert.match(source, /pregnancyUsgWeeks\.value\.trim\(\) === ''/);
  assert.match(source, /pregnancyConceptionDate\.value = ''/);
  assert.match(source, /pregnancyReferenceHidden\.value = ''/);
});

test('server persistence stores a scan date only for USG gestational-age mode', () => {
  const consultation = read('services/consultationService.js');
  const opdController = read('controllers/opdController.js');
  const opdService = read('services/opdService.js');
  assert.match(consultation, /usgDate: pregnancyStatus === 'PREGNANT' && datingMethod === 'USG'/);
  assert.match(opdController, /usgDate: status === 'PREGNANT' && datingMethod === 'USG'/);
  assert.match(opdService, /usgDate: isFemale && obstetricStatus === 'PREGNANT' && datingMethod === 'USG'/);
  assert.doesNotMatch(consultation, /datingMethod\.startsWith\('USG'\)/);
  assert.doesNotMatch(opdController, /datingMethod\.startsWith\('USG'\)/);
  assert.doesNotMatch(opdService, /datingMethod\.startsWith\('USG'\)/);
});
