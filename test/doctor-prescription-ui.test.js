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

test('login page does not offer Google sign-in', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'views', 'auth', 'login.ejs'), 'utf8');
  assert.doesNotMatch(source, /Continue with Google/i);
  assert.doesNotMatch(source, /href=["']\/auth\/google["']/i);
  assert.match(source, /name=["']identifier["']/);
  assert.match(source, /name=["']password["']/);
});

test('all rendered dates use dd-mm-yyyy formatters', () => {
  const { formatDate, formatDateTime } = require('../utils/dateFormat');
  assert.equal(formatDate('2026-10-08'), '08-10-2026');
  assert.match(formatDateTime('2026-10-08T14:35:00'), /^08-10-2026 14:35$/);

  const views = [
    'views/patients/list.ejs',
    'views/patients/profile.ejs',
    'views/opd/appointments.ejs',
    'views/opd/appointment-detail.ejs',
    'views/doctors/consultation.ejs',
    'views/billing/invoices.ejs',
    'views/patient-portal/dashboard.ejs',
    'views/patient-portal/prescription.ejs',
    'views/lab/orders.ejs',
    'views/pharmacy/batches.ejs',
    'views/print/token.ejs',
    'views/print/invoice.ejs',
    'views/print/prescription.ejs',
    'views/print/registration-slip.ejs'
  ];

  for (const relative of views) {
    const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    assert.doesNotMatch(source, /\.toLocaleDateString\s*\(/, relative);
    assert.doesNotMatch(source, /\.toLocaleString\s*\(/, relative);
  }
});

test('doctor Rx editor uses the requested default form, dose, and instructions for new medicines', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'views', 'doctors', 'consultation.ejs'), 'utf8');
  assert.match(source, /const medicineForm = item\.medicine_form \|\| 'Tablet';/);
  assert.match(source, /const dosage = item\.dosage \|\| '1';/);
  assert.match(source, /const instructions = item\.instructions \|\| 'After food';/);
  assert.match(source, /value="\'+esc\(dosage\)\+'"/);
  assert.match(source, /value="\'+esc\(instructions\)\+'"/);
});

test('OPD booking loads doctors after branch and department selection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'views', 'opd', 'book.ejs'), 'utf8');
  assert.match(source, /fetch\('\/doctors\/api\/list\?branchId=/);
  assert.match(source, /departmentId=/);
  assert.match(source, /doctorSel\.addEventListener\('change', loadDoctorDates\)/);
  assert.match(source, /available-dates/);
  assert.match(source, /\/doctors\/.*\/slots/);
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
  const leftColumnEndIndex = prescription.indexOf('</div>\n\n    <div class="rx-right">');
  assert.ok(adviceIndex > rightColumnIndex, 'Advice must be rendered in the right column');
  assert.ok(leftColumnEndIndex > 0 && adviceIndex > leftColumnEndIndex, 'Advice must not remain in the left column');
  const printCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'print.css'), 'utf8');
  assert.match(printCss, /grid-template-columns:39% 61%/);
  assert.match(printCss, /\.rx-compact-table th,.rx-compact-table td\{[^}]*font-size:9\.2px/);
  assert.match(printCss, /\.rx-med-name\{display:block;font-size:9\.8px/);
  assert.match(prescription, /class="rx-bengali-row"[\s\S]*?<td colspan="6">/);
  assert.doesNotMatch(prescription, /rx-bengali-row[\\s\\S]{0,800}medicine_name_freetext/);
  const textUtil = require('../utils/prescriptionText');
  const result = textUtil.describeItem({ medicine_form: 'tablet', dosage: '1', frequency: 'BD', route: 'P/O', duration: '5', instructions: 'After food' });
  assert.match(result.bengali, /দিনে 02 বার/);
  assert.doesNotMatch(result.bengali, /tablet|ট্যাবলেট.*[A-Z][A-Z]/i);
  assert.doesNotMatch(result.bengali, /medicine_name_freetext/i);
  assert.match(result.bengali, /খাবারের পরে/);
});


test('Agent OPD booking uses dynamic department, doctor, date and slot cascade', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'views', 'agent', 'opd-book.ejs'), 'utf8');
  assert.match(source, /\/doctors\/api\/list\?branchId=/);
  assert.match(source, /departmentId=/);
  assert.match(source, /agentDepartmentId/);
  assert.match(source, /agentDoctorId/);
  assert.match(source, /available-dates/);
  assert.match(source, /\/doctors\/.*\/slots/);
  assert.match(source, /agentSlotTime/);
  // flatpickr may call disable before picker is assigned; this must not abort startup.
  assert.ok(source.includes("disable:[d=>!availableDates.has(picker ? picker.formatDate(d,'Y-m-d') : '')]"));
  assert.ok(source.includes('<button type="submit" class="btn btn-primary btn-lg">Book OPD Appointment</button>'));
});


test('Receptionist Today Queue exposes vitals save flow and controller normalizes empty vitals', () => {
  const queue = fs.readFileSync(path.join(__dirname, '..', 'views', 'opd', 'queue.ejs'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'opdController.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '1001_receptionist_vitals_hardening.sql'), 'utf8');
  assert.match(queue, /\/opd\/visits\/<%= r\.visit_id %>\/vitals/);
  assert.match(controller, /respiratoryRate: String\(req\.body\.respiratoryRate \|\| ''\)\.trim\(\) \|\| null/);
  assert.match(controller, /INSERT INTO appointment_vitals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS appointment_vitals/);
  assert.match(migration, /respiratory_rate/);
  assert.match(migration, /queue\.manage/);
});


test('vitals pregnancy assessment renders without an undefined canEdit error', () => {
  const vitalsView = path.join(__dirname, '..', 'views', 'opd', 'vitals.ejs');
  const partial = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'pregnancy-assessment.ejs'), 'utf8');
  assert.match(partial, /typeof canEdit === 'undefined' \|\| canEdit !== false/);

  assert.doesNotThrow(() => {
    ejs.render(fs.readFileSync(vitalsView, 'utf8'), {
      csrfToken: 'test-token',
      visit: {
        id: 1,
        patient_name: 'Test Patient',
        health_id: '1234567890',
        token_number: 1,
        gender: 'female'
      },
      vitals: {},
      pregnancy: {},
      pregnancyCalculation: null
    }, { filename: vitalsView });
  });
});


test('doctor consultation persists Clinical Findings and defaults Rx duration to 7 days', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'doctors', 'consultation.ejs'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'consultationService.js'), 'utf8');
  const prescriptionService = fs.readFileSync(path.join(__dirname, '..', 'services', 'prescriptionService.js'), 'utf8');
  assert.match(view, /name="clinicalNotes"/);
  assert.match(view, /addFinding\(clinicalInput\.value, false\)/);
  assert.match(view, /const duration = item\.duration \|\| '7 days';/);
  assert.match(prescriptionService, /duration: durations\[i\] \|\| '7 days'/);
  assert.match(service, /clinical_notes = :notes/);
  assert.match(service, /notes: payload\.clinicalNotes \|\| null/);
});

test('doctor diagnostic selector renders checkbox list and custom add-test control', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'doctor-diagnostic-tests.js'), 'utf8');
  assert.match(source, /advice\.closest\('\.col-md-6'\)/);
  assert.match(source, /diagnostic-test-check/);
  assert.match(source, /Add Test/);
  assert.match(source, /CBC \(Complete Blood Count\)/);
});


test('receptionist patient registration offers active referral providers with both name and code', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'patientController.js'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'patients', 'new.ejs'), 'utf8');
  assert.match(controller, /SELECT id, provider_name, referral_code FROM referral_providers WHERE is_active = 1 ORDER BY provider_name/);
  assert.match(controller, /referralProviders/);
  assert.match(view, /name="referralProviderId"/);
  assert.match(view, /<%= r\.provider_name %> — <%= r\.referral_code %>/);
});

test('OPD booking marks full slots red and prevents selecting them', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'opd', 'book.ejs'), 'utf8');
  assert.match(view, /slot\.available != null/);
  assert.match(view, /btn-danger/);
  assert.match(view, /disabled aria-disabled="true" title="Already booked"/);
  assert.match(view, /if \(button\.disabled\) return/);
  const schedule = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduleService.js'), 'utf8');
  assert.match(schedule, /available: Math\.max\(0, capacity - bookedCount\)/);
});


test('doctor Rx editor uses readable frequencies and responsive medicine cards without horizontal table scrolling', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'doctors', 'consultation.ejs'), 'utf8');
  assert.match(view, /\['1 time daily','1 time daily'\]/);
  assert.match(view, /\['2 times daily','2 times daily'\]/);
  assert.match(view, /\['3 times daily','3 times daily'\]/);
  assert.match(view, /\['4 times daily','4 times daily'\]/);
  assert.match(view, /\['As needed','As needed'\]/);
  assert.match(view, /rx-medication-card/);
  assert.match(view, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(view, /min-height:44px;font-size:1rem/);
  assert.doesNotMatch(view, /table-responsive rx-editor-scroll/);
  assert.doesNotMatch(view, /const freq = \['OD','BD','TDS','QDS','SOS'\]/);
});

test('plain-language frequency prints correctly in English and Bengali', () => {
  const textUtil = require('../utils/prescriptionText');
  const twice = textUtil.describeItem({ medicine_form: 'Tablet', dosage: '1', frequency: '2 times daily', route: 'P/O', duration: '7 days', instructions: 'After food' });
  assert.match(twice.english, /twice daily/);
  assert.match(twice.bengali, /দিনে 02 বার/);
  const asNeeded = textUtil.describeItem({ medicine_form: 'Tablet', dosage: '1', frequency: 'As needed', route: 'P/O', duration: '7 days', instructions: 'After food' });
  assert.match(asNeeded.english, /as needed/);
  assert.match(asNeeded.bengali, /প্রয়োজনে/);
});

test('prescription save auto-registers medicine name and composition in medicine and pharmacy catalogues', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'prescriptionService.js'), 'utf8');
  assert.match(service, /INSERT INTO medicines \(name, strength, composition, form, is_active\)/);
  assert.match(service, /WHERE name = :name AND \(composition <=> :composition\)/);
  assert.match(service, /INSERT INTO pharmacy_medicines/);
  assert.match(service, /branch_id, medicine_id, sku, name, generic_name, strength, dosage_form/);
  assert.match(service, /VALUES\s*\n\s*\(:branchId, :medicineId, :sku, :name, :composition, NULL, :form,\s*0, 0, 0, 0, 1, :createdBy\)/);
  assert.match(service, /mrp, purchase_rate, sale_rate, reorder_level, prescription_required, created_by\)\s*\)\s*VALUES[\s\S]*?0, 0, 0, 0, 1/);
  assert.match(service, /medicineId,\s*name,\s*composition,\s*medicineForm: form/);
});
