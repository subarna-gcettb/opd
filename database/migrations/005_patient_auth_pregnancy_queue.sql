-- Patient self-service auth, obstetric booking context, and receptionist queue controls.
SET NAMES utf8mb4;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS patient_id INT UNSIGNED NULL AFTER branch_id;

SET @fk_patient_user_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'fk_users_patient'
);
SET @fk_patient_user_sql := IF(
  @fk_patient_user_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE patient_user_fk FROM @fk_patient_user_sql;
EXECUTE patient_user_fk;
DEALLOCATE PREPARE patient_user_fk;

SET @uk_patient_user_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'uk_users_patient_id'
);
SET @uk_patient_user_sql := IF(
  @uk_patient_user_exists = 0,
  'ALTER TABLE users ADD UNIQUE KEY uk_users_patient_id (patient_id)',
  'SELECT 1'
);
PREPARE patient_user_uk FROM @uk_patient_user_sql;
EXECUTE patient_user_uk;
DEALLOCATE PREPARE patient_user_uk;

INSERT INTO roles (code, name) VALUES ('PATIENT', 'Patient Portal User')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO permissions (code, description) VALUES
 ('patient.portal.access', 'Access the patient self-service portal')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'patient.portal.access'
WHERE r.code = 'PATIENT'
ON DUPLICATE KEY UPDATE role_id = role_id;

CREATE TABLE IF NOT EXISTS auth_otps (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purpose ENUM('SIGNUP','LOGIN','PASSWORD_RESET') NOT NULL,
  email VARCHAR(190) NOT NULL,
  otp_hash CHAR(64) NOT NULL,
  payload JSON NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_otp_lookup (purpose, email, expires_at),
  INDEX idx_auth_otp_created (created_at)
) ENGINE=InnoDB;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS lmp_date DATE NULL AFTER reason,
  ADD COLUMN IF NOT EXISTS gravida SMALLINT UNSIGNED NULL AFTER lmp_date,
  ADD COLUMN IF NOT EXISTS para SMALLINT UNSIGNED NULL AFTER gravida,
  ADD COLUMN IF NOT EXISTS abortions SMALLINT UNSIGNED NULL AFTER para,
  ADD COLUMN IF NOT EXISTS pregnancy_status ENUM('NOT_PREGNANT','PREGNANT','UNKNOWN') NULL AFTER abortions,
  ADD COLUMN IF NOT EXISTS gestational_age_weeks SMALLINT UNSIGNED NULL AFTER pregnancy_status,
  ADD COLUMN IF NOT EXISTS gestational_age_days TINYINT UNSIGNED NULL AFTER gestational_age_weeks,
  ADD COLUMN IF NOT EXISTS estimated_due_date DATE NULL AFTER gestational_age_days,
  ADD COLUMN IF NOT EXISTS obstetric_notes VARCHAR(1000) NULL AFTER estimated_due_date;

ALTER TABLE opd_visits
  ADD COLUMN IF NOT EXISTS queue_position INT UNSIGNED NULL AFTER status;
UPDATE opd_visits SET queue_position = token_number WHERE queue_position IS NULL;

CREATE INDEX IF NOT EXISTS idx_visit_queue_position ON opd_visits (doctor_id, queue_position, status);

CREATE TABLE IF NOT EXISTS appointment_vitals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visit_id INT UNSIGNED NOT NULL UNIQUE,
  bp VARCHAR(15) NULL,
  pulse SMALLINT UNSIGNED NULL,
  spo2 SMALLINT UNSIGNED NULL,
  temperature DECIMAL(4,1) NULL,
  height_cm DECIMAL(5,2) NULL,
  weight_kg DECIMAL(5,2) NULL,
  respiratory_rate SMALLINT UNSIGNED NULL,
  pain_score TINYINT UNSIGNED NULL,
  recorded_by INT UNSIGNED NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appt_vitals_visit FOREIGN KEY (visit_id) REFERENCES opd_visits(id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_vitals_user FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;
