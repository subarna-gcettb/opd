-- OPD usability and patient lifecycle patch
ALTER TABLE patients
  ADD COLUMN status ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE' AFTER deleted_at,
  ADD COLUMN suspended_at DATETIME NULL AFTER status,
  ADD COLUMN suspended_by INT UNSIGNED NULL AFTER suspended_at,
  ADD COLUMN suspension_reason VARCHAR(500) NULL AFTER suspended_by;

ALTER TABLE patients
  ADD CONSTRAINT fk_patients_suspended_by FOREIGN KEY (suspended_by) REFERENCES users(id);

INSERT INTO permissions (code, description) VALUES
  ('patient.suspend', 'Suspend or restore a patient record without deleting medical history')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'patient.suspend'
WHERE r.code IN ('SUPER_ADMIN','ADMIN')
ON DUPLICATE KEY UPDATE role_id = role_id;
