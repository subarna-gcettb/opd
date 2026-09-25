-- Adds patient.delete (soft-delete a patient record) and grants it to
-- SUPER_ADMIN explicitly (SUPER_ADMIN's CROSS JOIN grant in seed.sql
-- only covers permissions that existed at the time seed.sql last ran on
-- a given database, so a permission added after initial seeding must be
-- granted explicitly here too, not just created).
--
-- Also grants patient.edit to OPD_STAFF (receptionist) — previously
-- only ADMIN and SUPER_ADMIN could edit patient details, but reception
-- needs to be able to fix typos/updates in day-to-day registration.

INSERT INTO permissions (code, description) VALUES
  ('patient.delete', 'Soft-delete a patient record (Super Admin only by default)')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'patient.delete'
WHERE r.code = 'SUPER_ADMIN'
ON DUPLICATE KEY UPDATE role_id = role_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'patient.edit'
WHERE r.code = 'OPD_STAFF'
ON DUPLICATE KEY UPDATE role_id = role_id;
