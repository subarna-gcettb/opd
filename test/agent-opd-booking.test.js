const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('agent OPD booking renders a receptionist-style patient finder and branch ID', () => {
  const view = read('views/agent/opd-book.ejs');
  assert.doesNotThrow(() => ejs.compile(view, { filename: path.join(__dirname, '..', 'views', 'agent', 'opd-book.ejs') }));
  assert.match(view, /id="agentPatientSearch"/);
  assert.match(view, /Search by Health ID, patient name, mobile, registration number or Aadhaar last 4 digits/);
  assert.match(view, /fetch\('\/agent\/api\/patients\?q=/);
  assert.match(view, /const branchId='<%= agentBranchId %>'/);
  assert.match(view, /Selected patient:/);
  assert.match(view, /!healthIdField\.value/);
});

test('agent patient search is branch-scoped and supports receptionist identifiers', () => {
  const service = read('services/agentService.js');
  const controller = read('controllers/agentController.js');
  const routes = read('routes/agentRoutes.js');
  assert.match(service, /async function searchPatientsForAgent/);
  assert.match(service, /p\.branch_id = :branchId AND p\.deleted_at IS NULL/);
  assert.match(service, /p\.health_id = :exact/);
  assert.match(service, /p\.registration_number LIKE :like/);
  assert.match(service, /p\.name LIKE :like/);
  assert.match(service, /p\.mobile LIKE :like/);
  assert.match(service, /p\.aadhaar_last4 = :aadhaarLast4/);
  assert.match(controller, /agentService\.searchPatientsForAgent\(req\.query\.q,bid\)/);
  assert.match(routes, /router\.get\('\/api\/patients',requireAgent,asyncHandler\(controller\.searchPatients\)\)/);
});

test('agent appointment API can load doctors and dates but cannot inspect another branch', () => {
  const routes = read('routes/doctorRoutes.js');
  const controller = read('controllers/doctorController.js');
  assert.equal((routes.match(/agent\.appointment\.create/g) || []).length, 3);
  assert.match(controller, /const branchId = isAgent \? req\.user\.branch_id/);
  assert.match(controller, /async function assertAgentDoctorBranch/);
  assert.match(controller, /await assertAgentDoctorBranch\(req\)/);
});
