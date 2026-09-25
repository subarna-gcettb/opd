-- OPD usability and patient lifecycle patch
-- Safe for both legacy databases (where 001 was already applied before the
-- suspension fields existed) and fresh databases (where 001 now includes them).

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS status ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE' AFTER deleted_at,
  ADD COLUMN IF NOT EXISTS suspended_at DATETIME NULL AFTER status,
  ADD COLUMN IF NOT EXISTS suspended_by INT UNSIGNED NULL AFTER suspended_at,
  ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR(500) NULL AFTER suspended_by;

-- MySQL/MariaDB do not expose a portable ADD CONSTRAINT IF NOT EXISTS.
-- The FK is included in the fresh schema and this migration adds it only
-- when the legacy database does not already have it.
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'patients'
    AND CONSTRAINT_NAME = 'fk_patients_suspended_by'
);
SET @fk_sql := IF(
  @fk_exists = 0,
  'ALTER TABLE patients ADD CONSTRAINT fk_patients_suspended_by FOREIGN KEY (suspended_by) REFERENCES users(id)',
  'SELECT 1'
);
PREPARE fk_stmt FROM @fk_sql;
EXECUTE fk_stmt;
DEALLOCATE PREPARE fk_stmt;

INSERT INTO permissions (code, description) VALUES
  ('patient.suspend', 'Suspend or restore a patient record without deleting medical history')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'patient.suspend'
WHERE r.code IN ('SUPER_ADMIN','ADMIN','OPD_STAFF')
ON DUPLICATE KEY UPDATE role_id = role_id;
