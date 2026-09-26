-- OPD workflow hardening:
-- 1) receptionist vitals before consultation
-- 2) secure hard-copy prescription attachments
-- 3) one token sequence per calendar day (no duplicate token across doctors)
-- 4) appointment booking schema compatibility

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
  CONSTRAINT fk_appt_vitals_user FOREIGN KEY (recorded_by) REFERENCES users(id),
  INDEX idx_appt_vitals_recorded (recorded_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prescription_attachments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visit_id INT UNSIGNED NOT NULL,
  patient_id INT UNSIGNED NOT NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_name VARCHAR(255) NOT NULL UNIQUE,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rx_attach_visit FOREIGN KEY (visit_id) REFERENCES opd_visits(id) ON DELETE CASCADE,
  CONSTRAINT fk_rx_attach_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_rx_attach_user FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_rx_attach_visit (visit_id),
  INDEX idx_rx_attach_patient (patient_id)
) ENGINE=InnoDB;

SET @drop_old_token_index = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE appointments DROP INDEX uk_appt_doctor_date_token',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'appointments'
    AND index_name = 'uk_appt_doctor_date_token'
);
PREPARE stmt_drop_token FROM @drop_old_token_index;
EXECUTE stmt_drop_token;
DEALLOCATE PREPARE stmt_drop_token;

SET @add_daily_token_index = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE appointments ADD UNIQUE KEY uk_appt_date_token (appointment_date, token_number)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'appointments'
    AND index_name = 'uk_appt_date_token'
);
PREPARE stmt_add_token FROM @add_daily_token_index;
EXECUTE stmt_add_token;
DEALLOCATE PREPARE stmt_add_token;

INSERT INTO permissions (code, description)
VALUES ('prescription.attachment.upload', 'Upload a scanned hard-copy prescription for a completed visit')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.code = 'prescription.attachment.upload'
WHERE r.code IN ('SUPER_ADMIN','ADMIN','OPD_STAFF')
ON DUPLICATE KEY UPDATE role_id = role_id;
