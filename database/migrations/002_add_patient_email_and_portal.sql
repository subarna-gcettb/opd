-- Adds:
--   1. patients.email — optional, used for notifications and as the
--      patient's contact address; NOT used for login.
--   2. users.patient_id — nullable, unique FK to patients(id). A user
--      account with this set is a PATIENT PORTAL account: it belongs to
--      exactly one patient and every patient-portal route derives the
--      patient scope from this column server-side, never from a
--      request parameter (this is the IDOR guard for the portal).

ALTER TABLE patients
  ADD COLUMN email VARCHAR(150) NULL AFTER alt_mobile;

ALTER TABLE users
  ADD COLUMN patient_id INT UNSIGNED NULL UNIQUE AFTER branch_id,
  ADD CONSTRAINT fk_users_patient FOREIGN KEY (patient_id) REFERENCES patients(id);

-- New role + permission for the patient portal. Idempotent via
-- ON DUPLICATE KEY UPDATE so this migration is also safe if seed.sql
-- has already been run with an updated copy that includes these.
INSERT INTO roles (code, name) VALUES ('PATIENT', 'Patient (Portal)')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO permissions (code, description) VALUES
  ('patient.portal.access', 'Access the patient self-service portal (own records only)')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'patient.portal.access'
WHERE r.code = 'PATIENT'
ON DUPLICATE KEY UPDATE role_id = role_id;
