const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('doctor consultation and prescription templates compile', () => {
  const files = [
    path.join(__dirname, '..', 'views', 'doctors', 'consultation.ejs'),
    path.join(__dirname, '..', 'views', 'print', 'prescription.ejs')
  ];

  for (const file of files) {
    assert.doesNotThrow(() => {
      ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
    }, file);
  }
});

test('unified doctor consultation form contains one save action and no Symptoms field', () => {
  const file = path.join(__dirname, '..', 'views', 'doctors', 'consultation.ejs');
  const source = fs.readFileSync(file, 'utf8');

  assert.equal(source.includes('name="symptoms"'), false);
  assert.equal(source.includes('Clinical Findings'), true);
  assert.equal(source.includes('Save Consultation &amp; Prescription'), true);
  assert.equal(source.includes('Is this consultation complementary?'), true);
});


test('Edit Consultation route forces edit mode instead of rendering finalized visits read-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'doctorPortalController.js'), 'utf8');
  assert.match(source, /async function editConsultation[\s\S]*?consultation\(req, res, next, \{ edit: '1' \}\)/);
  assert.doesNotMatch(source, /new URLSearchParams\(\{ edit: '1' \}\)/);
  const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'doctors', 'consultation.ejs'), 'utf8');
  assert.match(view, /name="_editMode" value="<%= editMode \? '1' : '0' %>"/);
  assert.match(view, /href="\/doctor\/consultation\/<%= visit\.id %>\/edit"/);
});


test('pregnancy calculator supports USG and ultrasound EDD dating', () => {
  const calc = require('../utils/pregnancyCalculator');
  const usg = calc.calculatePregnancyFromUltrasound('2026-10-08', 12, 3, new Date(2026, 9, 8));
  assert.ok(usg);
  assert.equal(usg.referenceMode, 'USG');
  assert.equal(usg.gestationalAgeWeeks, 12);
  assert.equal(usg.gestationalAgeDays, 3);
  assert.equal(usg.estimatedDueDate, '2027-04-19');

  const usgEdd = calc.calculatePregnancyFromUltrasoundEdd('2027-04-19', new Date(2026, 9, 8));
  assert.ok(usgEdd);
  assert.equal(usgEdd.referenceMode, 'USG_EDD');
  assert.equal(usgEdd.estimatedDueDate, '2027-04-19');
});

test('OTP signup verification accepts mysql2 JSON objects without JSON.parse errors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'authController.js'), 'utf8');
  assert.match(source, /typeof record\.payload === 'string'/);
  assert.match(source, /\? JSON\.parse\(record\.payload \|\| '\{\}'\)/);
  assert.match(source, /:\s*\(record\.payload \|\| \{\}\)/);
  assert.doesNotMatch(source, /const payload = JSON\.parse\(record\.payload/);
});

test('USG dating migration and Bengali prescription rows are present', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '1007_ultrasound_pregnancy_dating.sql'), 'utf8');
  for (const field of ['pregnancy_dating_method', 'usg_date', 'usg_gestational_age_weeks', 'usg_gestational_age_days', 'usg_edd']) {
    assert.match(migration, new RegExp(field, 'i'));
  }
  const prescription = fs.readFileSync(path.join(__dirname, '..', 'views', 'print', 'prescription.ejs'), 'utf8');
  assert.match(prescription, /rx-bengali-row/);
  assert.match(prescription, /<td colspan="6">[\s\S]*?বাংলা নির্দেশনা:/);
  const adviceIndex = prescription.indexOf('<% if (prescription.advice)');
  const rightColumnIndex = prescription.indexOf('<div class="rx-right">');
  assert.ok(adviceIndex > 0 && adviceIndex < rightColumnIndex, 'Advice must stay in the left column');
  const vitalsMarker = prescription.lastIndexOf('<% if (hasVitals)');
  assert.ok(adviceIndex > vitalsMarker, 'Advice must be rendered after the left-column clinical sections');
  assert.match(prescription, /class="rx-bengali-row"[\s\S]*?<td colspan="6">/);
  assert.doesNotMatch(prescription, /rx-bengali-row[\\s\\S]{0,800}medicine_name_freetext/);
  const textUtil = require('../utils/prescriptionText');
  const result = textUtil.describeItem({ medicine_form: 'tablet', dosage: '1', frequency: 'BD', route: 'P/O', duration: '5', instructions: 'After food' });
  assert.match(result.bengali, /দিনে ২ বার/);
  assert.match(result.bengali, /খাবারের পরে/);
});
