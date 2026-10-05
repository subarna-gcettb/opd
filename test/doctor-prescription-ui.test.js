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
