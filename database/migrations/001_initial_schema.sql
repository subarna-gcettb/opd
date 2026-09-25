-- =====================================================================
-- Chhayabithi HMS — OPD Module — Core Schema
-- MySQL 8+ / InnoDB / utf8mb4
-- Run on a fresh database. Idempotent-ish via IF NOT EXISTS where safe.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. IDENTITY / AUTH / RBAC
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS branches (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(4) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(20) NULL,
  email VARCHAR(150) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,      -- SUPER_ADMIN, ADMIN, OPD_STAFF, DOCTOR
  name VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,      -- e.g. patient.create, discount.approve
  description VARCHAR(255) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id INT UNSIGNED NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  mobile VARCHAR(15) NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_reset_password TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  INDEX idx_users_branch (branch_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Session store table (compatible with express-mysql-session)
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. SEQUENCE COUNTERS (backs Health ID / reg no / invoice no / tokens)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sequence_counters (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope_key VARCHAR(80) NOT NULL UNIQUE,   -- e.g. 'healthid:2026:01', 'invoice:2026:01'
  current_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. PATIENTS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS patients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  health_id VARCHAR(11) NOT NULL UNIQUE,
  registration_number VARCHAR(20) NOT NULL UNIQUE,
  branch_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  father_name VARCHAR(150) NULL,
  husband_name VARCHAR(150) NULL,
  gender ENUM('Male','Female','Other') NOT NULL,
  dob DATE NULL,
  age_years SMALLINT UNSIGNED NULL,
  mobile VARCHAR(15) NOT NULL,
  alt_mobile VARCHAR(15) NULL,
  aadhaar_encrypted VARBINARY(512) NULL,
  aadhaar_iv VARBINARY(32) NULL,
  aadhaar_hash CHAR(64) NULL,
  aadhaar_last4 CHAR(4) NULL,
  deleted_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_patients_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_patients_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_patients_mobile (mobile),
  INDEX idx_patients_name (name),
  INDEX idx_patients_aadhaar_hash (aadhaar_hash),
  INDEX idx_patients_branch (branch_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_addresses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id INT UNSIGNED NOT NULL,
  address VARCHAR(255) NULL,
  village_town VARCHAR(120) NULL,
  police_station VARCHAR(120) NULL,
  district VARCHAR(120) NULL,
  state VARCHAR(120) NULL,
  pin_code VARCHAR(10) NULL,
  CONSTRAINT fk_paddr_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  UNIQUE KEY uk_paddr_patient (patient_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_medical_profiles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id INT UNSIGNED NOT NULL,
  blood_group VARCHAR(5) NULL,
  height_cm DECIMAL(5,2) NULL,
  weight_kg DECIMAL(5,2) NULL,
  allergies TEXT NULL,
  existing_conditions TEXT NULL,
  emergency_contact VARCHAR(15) NULL,
  emergency_contact_relation VARCHAR(60) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pmp_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  UNIQUE KEY uk_pmp_patient (patient_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. DOCTORS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS doctors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  doctor_code VARCHAR(20) NOT NULL UNIQUE,
  gender ENUM('Male','Female','Other') NULL,
  dob DATE NULL,
  mobile VARCHAR(15) NULL,
  email VARCHAR(150) NULL,
  address VARCHAR(255) NULL,
  professional_reg_number VARCHAR(60) NULL,
  qualification VARCHAR(255) NULL,
  specialisation VARCHAR(150) NULL,
  department_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NOT NULL,
  experience_years SMALLINT UNSIGNED NULL,
  consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  joining_date DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_doctors_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_doctors_dept FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_doctors_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  INDEX idx_doctors_dept (department_id),
  INDEX idx_doctors_branch (branch_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctor_schedule_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,     -- 0=Sunday .. 6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  max_patients_per_slot SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_dst_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  INDEX idx_dst_doctor_weekday (doctor_id, weekday)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctor_schedule_exceptions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT UNSIGNED NOT NULL,
  exception_date DATE NOT NULL,
  is_unavailable TINYINT(1) NOT NULL DEFAULT 1,
  start_time TIME NULL,
  end_time TIME NULL,
  reason VARCHAR(255) NULL,
  CONSTRAINT fk_dse_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  UNIQUE KEY uk_dse_doctor_date (doctor_id, exception_date)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. APPOINTMENTS / VISITS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS appointments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_code VARCHAR(20) NOT NULL UNIQUE,
  patient_id INT UNSIGNED NOT NULL,
  doctor_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  appointment_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  token_number SMALLINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NULL,
  status ENUM('BOOKED','RESCHEDULED','CANCELLED','NO_SHOW','COMPLETED') NOT NULL DEFAULT 'BOOKED',
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_appt_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT fk_appt_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_appt_dept FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_appt_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uk_appt_doctor_date_token (doctor_id, appointment_date, token_number),
  INDEX idx_appt_patient (patient_id),
  INDEX idx_appt_doctor_date (doctor_id, appointment_date),
  INDEX idx_appt_date_status (appointment_date, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointment_history (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id INT UNSIGNED NOT NULL,
  old_date DATE NULL,
  old_time TIME NULL,
  new_date DATE NULL,
  new_time TIME NULL,
  action VARCHAR(30) NOT NULL,     -- RESCHEDULED, CANCELLED, NO_SHOW
  reason VARCHAR(500) NULL,
  changed_by INT UNSIGNED NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ah_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT fk_ah_user FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_ah_appt (appointment_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS opd_visits (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visit_code VARCHAR(20) NOT NULL UNIQUE,
  appointment_id INT UNSIGNED NOT NULL UNIQUE,
  patient_id INT UNSIGNED NOT NULL,
  doctor_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  status ENUM('WAITING','CALLED','IN_CONSULTATION','COMPLETED','CANCELLED') NOT NULL DEFAULT 'WAITING',
  checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at DATETIME NULL,
  consultation_started_at DATETIME NULL,
  completed_at DATETIME NULL,
  CONSTRAINT fk_visit_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  CONSTRAINT fk_visit_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_visit_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT fk_visit_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  INDEX idx_visit_patient (patient_id),
  INDEX idx_visit_doctor_status (doctor_id, status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. CONSULTATION
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS opd_consultations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visit_id INT UNSIGNED NOT NULL UNIQUE,
  complaints TEXT NULL,
  symptoms TEXT NULL,
  clinical_notes TEXT NULL,
  diagnosis TEXT NULL,
  investigation_advice TEXT NULL,
  follow_up_date DATE NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cons_visit FOREIGN KEY (visit_id) REFERENCES opd_visits(id) ON DELETE CASCADE,
  CONSTRAINT fk_cons_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vitals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  consultation_id INT UNSIGNED NOT NULL UNIQUE,
  bp VARCHAR(15) NULL,
  pulse SMALLINT UNSIGNED NULL,
  temperature DECIMAL(4,1) NULL,
  spo2 SMALLINT UNSIGNED NULL,
  weight_kg DECIMAL(5,2) NULL,
  height_cm DECIMAL(5,2) NULL,
  CONSTRAINT fk_vitals_cons FOREIGN KEY (consultation_id) REFERENCES opd_consultations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. PRESCRIPTIONS (versioned)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS medicines (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  strength VARCHAR(40) NULL,
  form VARCHAR(40) NULL,          -- Tablet, Syrup, Injection...
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_medicine_name_strength (name, strength)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prescriptions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prescription_code VARCHAR(20) NOT NULL,
  visit_id INT UNSIGNED NOT NULL,
  patient_id INT UNSIGNED NOT NULL,
  doctor_id INT UNSIGNED NOT NULL,
  version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  barcode_value VARCHAR(20) NOT NULL,     -- the patient's Health ID
  amended_from_id INT UNSIGNED NULL,
  amendment_reason VARCHAR(500) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_presc_visit FOREIGN KEY (visit_id) REFERENCES opd_visits(id),
  CONSTRAINT fk_presc_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_presc_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT fk_presc_amended_from FOREIGN KEY (amended_from_id) REFERENCES prescriptions(id),
  CONSTRAINT fk_presc_user FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uk_presc_code_version (prescription_code, version),
  INDEX idx_presc_patient (patient_id),
  INDEX idx_presc_visit (visit_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prescription_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prescription_id INT UNSIGNED NOT NULL,
  medicine_id INT UNSIGNED NULL,
  medicine_name_freetext VARCHAR(150) NOT NULL,
  dosage VARCHAR(60) NULL,
  frequency VARCHAR(60) NULL,
  duration VARCHAR(60) NULL,
  route VARCHAR(40) NULL,
  quantity VARCHAR(30) NULL,
  instructions VARCHAR(255) NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT fk_pi_presc FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  INDEX idx_pi_presc (prescription_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. BILLING
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(20) NOT NULL UNIQUE,
  patient_id INT UNSIGNED NOT NULL,
  visit_id INT UNSIGNED NOT NULL,
  doctor_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  gross_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('DRAFT','AWAITING_PAYMENT','PAID','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_inv_visit FOREIGN KEY (visit_id) REFERENCES opd_visits(id),
  CONSTRAINT fk_inv_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT fk_inv_dept FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_inv_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_inv_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_inv_patient (patient_id),
  INDEX idx_inv_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED NOT NULL,
  description VARCHAR(255) NOT NULL,
  item_type ENUM('CONSULTATION','OTHER') NOT NULL DEFAULT 'OTHER',
  amount DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_ii_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  INDEX idx_ii_invoice (invoice_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_code VARCHAR(20) NOT NULL UNIQUE,
  receipt_number VARCHAR(20) NOT NULL UNIQUE,
  invoice_id INT UNSIGNED NOT NULL,
  patient_id INT UNSIGNED NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('CASH','UPI','CARD') NOT NULL,
  reference_number VARCHAR(80) NULL,
  paid_by INT UNSIGNED NOT NULL,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_pay_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_pay_user FOREIGN KEY (paid_by) REFERENCES users(id),
  INDEX idx_pay_invoice (invoice_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS discount_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED NOT NULL,
  requested_amount DECIMAL(10,2) NULL,
  requested_percentage DECIMAL(5,2) NULL,
  reason VARCHAR(500) NOT NULL,
  requested_by INT UNSIGNED NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  CONSTRAINT fk_dr_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_dr_req_user FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_dr_appr_user FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_dr_status (status),
  INDEX idx_dr_invoice (invoice_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. AUDIT / SETTINGS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(40) NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_entity (entity, entity_id),
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS system_settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id INT UNSIGNED NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value VARCHAR(500) NULL,
  UNIQUE KEY uk_settings_branch_key (branch_id, setting_key),
  CONSTRAINT fk_settings_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
