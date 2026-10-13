const { pool } = require('../config/database');
const patientService = require('./patientService');
const AppError = require('../utils/AppError');
const referralService = require('./referralService');

function referralCode(value, userId) {
  const supplied = referralService.normalizeCode(value);
  return supplied || '';
}

async function requireReferralCode(value) {
  const provider = await referralService.resolveActiveCode(value);
  return provider;
}

/**
 * Existing patients keep their original referral attribution even when a
 * provider is later deactivated. New referral selections must still resolve
 * through the Super Admin managed active-code list.
 */
async function resolveReferralForPatient(patient, value) {
  const supplied = referralService.normalizeCode(value);
  if (!supplied) throw new AppError('Select a referral provider/code.', 422);

  const stored = referralService.normalizeCode(patient && patient.referral_code);
  if (stored && patient.referral_provider_id && stored === supplied) {
    const [[provider]] = await pool.execute(
      'SELECT id, referral_code, provider_name, provider_type FROM referral_providers WHERE id=:id',
      { id: patient.referral_provider_id }
    );
    if (provider) return provider;
  }

  return requireReferralCode(supplied);
}

async function dashboard(agentId, branchId) {
  const [[patients]] = await pool.execute(
    'SELECT COUNT(*) AS count FROM patients WHERE branch_id=:branchId AND deleted_at IS NULL AND created_by=:agentId',
    { branchId, agentId }
  );
  const [[opd]] = await pool.execute(
    'SELECT COUNT(*) AS count FROM appointments WHERE branch_id=:branchId AND created_by=:agentId AND status <> "CANCELLED"',
    { branchId, agentId }
  );
  const [[tests]] = await pool.execute(
    'SELECT COUNT(*) AS count FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id WHERE l.branch_id=:branchId AND o.ordered_by=:agentId AND o.status <> "CANCELLED"',
    { branchId, agentId }
  );
  const [[referrals]] = await pool.execute(
    `SELECT COUNT(*) AS count FROM (
       SELECT referral_code FROM patients WHERE referral_code IS NOT NULL AND referral_code<>'' AND branch_id=:branchId AND created_by=:agentId
       UNION
       SELECT referral_code FROM appointments WHERE referral_code IS NOT NULL AND referral_code<>'' AND branch_id=:branchId AND created_by=:agentId
       UNION
       SELECT o.referral_code FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id
       WHERE o.referral_code IS NOT NULL AND o.referral_code<>'' AND l.branch_id=:branchId AND o.ordered_by=:agentId
     ) x`,
    { branchId, agentId }
  );
  return { patients: Number(patients.count), opd: Number(opd.count), tests: Number(tests.count), referrals: Number(referrals.count) };
}

async function patientList(agentId, branchId, q = '') {
  const params = { agentId, branchId, like: '%' + String(q || '').trim() + '%' };
  const where = [
    'p.branch_id=:branchId',
    'p.deleted_at IS NULL',
    '(p.created_by=:agentId OR EXISTS (SELECT 1 FROM appointments ax WHERE ax.patient_id=p.id AND ax.created_by=:agentId) OR EXISTS (SELECT 1 FROM lab_orders lx JOIN laboratories lbx ON lbx.id=lx.laboratory_id WHERE lx.patient_id=p.id AND lx.ordered_by=:agentId))'
  ];
  if (String(q || '').trim()) {
    where.push('(p.health_id=:exact OR p.registration_number LIKE :like OR p.name LIKE :like OR p.mobile LIKE :like)');
    params.exact = String(q).trim();
  }
  const [rows] = await pool.execute(
    `SELECT p.id,p.health_id,p.registration_number,p.name,p.gender,p.age_years,p.mobile,p.referral_code,rp.provider_name AS referral_provider_name,p.created_at,
       creator.name AS registered_by,
       (SELECT GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ', ') FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=creator.id) AS registered_by_role,
       (SELECT u2.name FROM appointments a2 JOIN users u2 ON u2.id=a2.created_by WHERE a2.patient_id=p.id ORDER BY a2.created_at DESC LIMIT 1) AS latest_booked_by,
       (SELECT (SELECT GROUP_CONCAT(DISTINCT r2.code ORDER BY r2.code SEPARATOR ', ') FROM user_roles ur2 JOIN roles r2 ON r2.id=ur2.role_id WHERE ur2.user_id=a2.created_by) FROM appointments a2 WHERE a2.patient_id=p.id ORDER BY a2.created_at DESC LIMIT 1) AS latest_booked_by_role,
       (SELECT a3.referral_code FROM appointments a3 WHERE a3.patient_id=p.id ORDER BY a3.created_at DESC LIMIT 1) AS latest_opd_referral
     FROM patients p
     LEFT JOIN referral_providers rp ON rp.id=p.referral_provider_id
     LEFT JOIN users creator ON creator.id=p.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY p.created_at DESC LIMIT 250`,
    params
  );
  return rows;
}

async function referralStats(branchId) {
  const [rows] = await pool.execute(
    `SELECT codes.referral_code, codes.provider_name,
       (SELECT COUNT(*) FROM patients p WHERE p.branch_id=:branchId AND p.referral_code=codes.referral_code AND p.deleted_at IS NULL) AS patients,
       (SELECT COUNT(*) FROM appointments a WHERE a.branch_id=:branchId AND a.referral_code=codes.referral_code AND a.status<>'CANCELLED') AS opd,
       (SELECT COUNT(*) FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id WHERE l.branch_id=:branchId AND o.referral_code=codes.referral_code AND o.status<>'CANCELLED') AS tests
     FROM (
       SELECT DISTINCT p.referral_code, rp.provider_name FROM patients p LEFT JOIN referral_providers rp ON rp.id=p.referral_provider_id WHERE p.branch_id=:branchId AND p.referral_code IS NOT NULL AND p.referral_code<>''
       UNION SELECT DISTINCT a.referral_code, rp2.provider_name FROM appointments a LEFT JOIN referral_providers rp2 ON rp2.id=a.referral_provider_id WHERE a.branch_id=:branchId AND a.referral_code IS NOT NULL AND a.referral_code<>''
       UNION SELECT DISTINCT o.referral_code, rp3.provider_name FROM lab_orders o JOIN laboratories l ON l.id=o.laboratory_id LEFT JOIN referral_providers rp3 ON rp3.id=o.referral_provider_id WHERE l.branch_id=:branchId AND o.referral_code IS NOT NULL AND o.referral_code<>''
     ) codes
     ORDER BY patients DESC, opd DESC, tests DESC, codes.referral_code`,
    { branchId }
  );
  return rows;
}

async function registerPatient(payload, agentId, branchId) {
  const provider = await requireReferralCode(payload.referralCode);
  return patientService.registerPatient({ ...payload, branchId, referralCode: provider.referral_code, referralProviderId: provider.id }, agentId);
}

async function searchPatientsForAgent(q, branchId, limit = 10) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const safeLimit = Math.min(20, Math.max(1, Number.parseInt(limit, 10) || 10));
  const like = '%' + term + '%';
  const isAadhaarLast4 = /^\d{4}$/.test(term);
  const sql = 'SELECT p.id, p.health_id, p.registration_number, p.name, p.gender, p.age_years, p.mobile, p.aadhaar_last4, p.referral_code, p.referral_provider_id, rp.provider_name AS referral_provider_name ' +
    'FROM patients p LEFT JOIN referral_providers rp ON rp.id = p.referral_provider_id ' +
    'WHERE p.branch_id = :branchId AND p.deleted_at IS NULL ' +
    'AND (p.health_id = :exact OR p.registration_number LIKE :like OR p.name LIKE :like OR p.mobile LIKE :like ' +
    (isAadhaarLast4 ? 'OR p.aadhaar_last4 = :aadhaarLast4 ' : '') +
    ') ORDER BY CASE WHEN p.health_id = :exact THEN 0 ELSE 1 END, p.created_at DESC LIMIT ' + safeLimit;
  const params = isAadhaarLast4 ? { branchId, exact: term, like, aadhaarLast4: term } : { branchId, exact: term, like };
  const [rows] = await pool.execute(sql, params);
  return rows.map((row) => ({ ...row, aadhaar_masked: row.aadhaar_last4 ? '•••• •••• ' + row.aadhaar_last4 : null }));
}
async function getReferralProviders() { return referralService.listActiveProviders(); }

async function getBookingContext(branchId) {
  const [departments] = await pool.execute('SELECT id,name FROM departments WHERE is_active=1 ORDER BY name');
  const [doctors] = await pool.execute(
    `SELECT d.id,u.name AS doctor_name,d.department_id,d.consultation_fee
     FROM doctors d JOIN users u ON u.id=d.user_id
     WHERE d.branch_id=:branchId AND d.is_active=1 AND d.deleted_at IS NULL ORDER BY u.name`,
    { branchId }
  );
  return { departments, doctors };
}

async function getTestContext(branchId) {
  const labService = require('./labService');
  return labService.getAvailableTestsForBranch(branchId);
}

async function getPatient(healthId, branchId) {
  const data = await patientService.getPatientProfile(healthId);
  if (!data || Number(data.patient.branch_id) !== Number(branchId)) return null;
  return data.patient;
}

module.exports = { dashboard, patientList, referralStats, registerPatient, referralCode, requireReferralCode, resolveReferralForPatient, getReferralProviders, searchPatientsForAgent, getBookingContext, getTestContext, getPatient };
