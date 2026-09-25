const { pool } = require('../config/database');
const auditService = require('./auditService');

const DEFAULTS = {
  hospital_name: 'Chhayabithi',
  hospital_tagline: 'Multi-Specialty Clinic & Diagnostic Centre',
  logo_path: '',
  favicon_path: '',
  seo_title: 'Chhayabithi Hospital Management System',
  seo_description:
    'Chhayabithi — multi-specialty clinic in Berhampore, Murshidabad. Book OPD appointments, consult doctors, and access your health records online.',
  seo_keywords: 'Chhayabithi, hospital, Berhampore, Murshidabad, OPD, doctor appointment, patient portal',
  og_image_path: '',
  contact_phone: '+91 787 8900 200',
  contact_email: 'info@chhayabithi.com',
  contact_address: '136/1 Abdus Samad Road, Gorabazar, Berhampore, Murshidabad, West Bengal',
  // Controls whether the PUBLIC (unauthenticated) Live OPD page shows
  // patient names alongside token/status. Defaults on per explicit
  // request, but this is a genuine privacy tradeoff — anyone on the
  // internet, not just people in the waiting room, can see who is
  // currently being seen by which doctor. Super Admin can turn it off
  // in Site Settings; when off, the public page still shows live
  // token numbers and statuses, just not names.
  live_opd_show_names: '1'
};

/** Returns every site setting merged with sensible defaults for anything not yet set. */
async function getSettings() {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM system_settings WHERE branch_id IS NULL');
  const stored = {};
  rows.forEach((r) => {
    stored[r.setting_key] = r.setting_value;
  });
  return { ...DEFAULTS, ...stored };
}

/** Upserts one or more global settings in a single pass. */
async function updateSettings(values, actorUserId) {
  const entries = Object.entries(values).filter(([key]) => key in DEFAULTS);
  for (const [key, value] of entries) {
    const normalized = value === undefined || value === null ? null : String(value);
    // NOTE: system_settings' UNIQUE(branch_id, setting_key) does NOT fire
    // for branch_id IS NULL (MySQL treats NULL as distinct from NULL in
    // unique indexes), so `ON DUPLICATE KEY UPDATE` would silently insert
    // a new row every call instead of updating the existing global
    // setting. Select-then-write explicitly instead.
    const [existing] = await pool.execute(
      'SELECT id FROM system_settings WHERE branch_id IS NULL AND setting_key = :key LIMIT 1',
      { key }
    );
    if (existing.length) {
      await pool.execute('UPDATE system_settings SET setting_value = :value WHERE id = :id', {
        value: normalized,
        id: existing[0].id
      });
    } else {
      await pool.execute(
        'INSERT INTO system_settings (branch_id, setting_key, setting_value) VALUES (NULL, :key, :value)',
        { key, value: normalized }
      );
    }
  }
  await auditService.log({
    userId: actorUserId,
    action: 'SITE_SETTINGS_UPDATED',
    entity: 'system_settings',
    newValue: values
  });
}

module.exports = { getSettings, updateSettings, DEFAULTS };
