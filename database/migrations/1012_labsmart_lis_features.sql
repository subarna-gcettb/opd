-- LabSmart-inspired LIS operations: packages, payments, expenses, secure sharing and home collection.
-- Additive only; existing OPD, orders, reports and data are preserved.

CREATE TABLE IF NOT EXISTS lab_test_packages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  laboratory_id INT UNSIGNED NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description VARCHAR(500) NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_package_lab FOREIGN KEY (laboratory_id) REFERENCES laboratories(id),
  CONSTRAINT fk_lab_package_creator FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uk_lab_package_code (laboratory_id, code),
  INDEX idx_lab_package_active (laboratory_id, is_active, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_test_package_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  package_id INT UNSIGNED NOT NULL,
  test_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_package_item_package FOREIGN KEY (package_id) REFERENCES lab_test_packages(id) ON DELETE CASCADE,
  CONSTRAINT fk_lab_package_item_test FOREIGN KEY (test_id) REFERENCES lab_tests(id),
  UNIQUE KEY uk_lab_package_test (package_id, test_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_order_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lab_order_id INT UNSIGNED NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method ENUM('CASH','UPI','CARD','BANK_TRANSFER','CHEQUE','OTHER') NOT NULL DEFAULT 'CASH',
  reference_no VARCHAR(120) NULL,
  notes VARCHAR(500) NULL,
  received_by INT UNSIGNED NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_payment_order FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id),
  CONSTRAINT fk_lab_payment_user FOREIGN KEY (received_by) REFERENCES users(id),
  INDEX idx_lab_payment_date (received_at),
  INDEX idx_lab_payment_order (lab_order_id, received_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id INT UNSIGNED NOT NULL,
  laboratory_id INT UNSIGNED NOT NULL,
  category VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  expense_date DATE NOT NULL,
  payment_method ENUM('CASH','UPI','CARD','BANK_TRANSFER','CHEQUE','OTHER') NOT NULL DEFAULT 'CASH',
  reference_no VARCHAR(120) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_expense_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_lab_expense_lab FOREIGN KEY (laboratory_id) REFERENCES laboratories(id),
  CONSTRAINT fk_lab_expense_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_lab_expense_branch_date (branch_id, expense_date),
  INDEX idx_lab_expense_category (laboratory_id, category, expense_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_share_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  lab_order_id INT UNSIGNED NOT NULL,
  lab_result_id INT UNSIGNED NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_share_order FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_lab_share_result FOREIGN KEY (lab_result_id) REFERENCES lab_results(id) ON DELETE CASCADE,
  CONSTRAINT fk_lab_share_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_lab_share_order (lab_order_id, expires_at),
  INDEX idx_lab_share_result (lab_result_id, expires_at)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS lab_settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  laboratory_id INT UNSIGNED NOT NULL,
  google_review_url VARCHAR(1000) NULL,
  review_message VARCHAR(1000) NULL,
  report_font_size_pt DECIMAL(4,1) NOT NULL DEFAULT 10,
  report_margin_top_mm DECIMAL(5,1) NOT NULL DEFAULT 10,
  report_margin_bottom_mm DECIMAL(5,1) NOT NULL DEFAULT 10,
  report_show_interpretation TINYINT(1) NOT NULL DEFAULT 1,
  report_show_comments TINYINT(1) NOT NULL DEFAULT 1,
  report_show_method TINYINT(1) NOT NULL DEFAULT 1,
  report_show_instrument TINYINT(1) NOT NULL DEFAULT 1,
  updated_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_settings_lab FOREIGN KEY (laboratory_id) REFERENCES laboratories(id),
  CONSTRAINT fk_lab_settings_user FOREIGN KEY (updated_by) REFERENCES users(id),
  UNIQUE KEY uk_lab_settings_laboratory (laboratory_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_tpa_claims (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lab_order_id INT UNSIGNED NOT NULL,
  insurer_name VARCHAR(180) NOT NULL,
  policy_number VARCHAR(120) NULL,
  claim_number VARCHAR(120) NULL,
  claim_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  approved_amount DECIMAL(10,2) NULL,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('DRAFT','SUBMITTED','QUERY','APPROVED','REJECTED','SETTLED') NOT NULL DEFAULT 'DRAFT',
  submitted_at DATETIME NULL,
  settled_at DATETIME NULL,
  notes VARCHAR(1000) NULL,
  created_by INT UNSIGNED NOT NULL,
  updated_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_tpa_order FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id),
  CONSTRAINT fk_lab_tpa_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_lab_tpa_updater FOREIGN KEY (updated_by) REFERENCES users(id),
  UNIQUE KEY uk_lab_tpa_order (lab_order_id),
  INDEX idx_lab_tpa_status (status, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_notification_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lab_order_id INT UNSIGNED NOT NULL,
  lab_result_id INT UNSIGNED NULL,
  channel ENUM('EMAIL','WHATSAPP','SMS') NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  status ENUM('PREPARED','SENT','FAILED') NOT NULL DEFAULT 'PREPARED',
  message VARCHAR(1000) NULL,
  error_message VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_notify_order FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_lab_notify_result FOREIGN KEY (lab_result_id) REFERENCES lab_results(id) ON DELETE SET NULL,
  CONSTRAINT fk_lab_notify_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_lab_notify_order (lab_order_id, created_at)
) ENGINE=InnoDB;

ALTER TABLE lab_orders
  MODIFY COLUMN source ENUM('DOCTOR','PATIENT','RECEPTION','LAB','AGENT') NOT NULL DEFAULT 'RECEPTION';

ALTER TABLE lab_orders
  ADD COLUMN discount_reason VARCHAR(500) NULL,
  ADD COLUMN collection_type ENUM('IN_LAB','HOME') NOT NULL DEFAULT 'IN_LAB',
  ADD COLUMN home_collection_address VARCHAR(700) NULL,
  ADD COLUMN home_collection_scheduled_at DATETIME NULL,
  ADD COLUMN home_collection_assigned_to INT UNSIGNED NULL,
  ADD COLUMN home_collection_status ENUM('NOT_REQUIRED','REQUESTED','ASSIGNED','COLLECTED','CANCELLED') NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD CONSTRAINT fk_lab_order_phlebotomist FOREIGN KEY (home_collection_assigned_to) REFERENCES users(id);

ALTER TABLE lab_workers
  MODIFY COLUMN worker_type ENUM('RECEPTION','TECHNICIAN','PATHOLOGIST','RADIOLOGIST','CARDIOLOGY','ADMIN','QUALITY','PHLEBOTOMIST') NOT NULL DEFAULT 'TECHNICIAN';

ALTER TABLE lab_test_parameters
  ADD COLUMN formula_expression VARCHAR(1000) NULL;

INSERT INTO permissions (code, description) VALUES
  ('lab.packages.manage', 'Create and maintain laboratory test panels and packages'),
  ('lab.accounting.view', 'View laboratory collections, expenses and business analytics'),
  ('lab.accounting.manage', 'Record laboratory payments and expenses'),
  ('lab.data.export', 'Export laboratory operations data'),
  ('lab.report.share', 'Create secure report sharing links'),
  ('lab.tpa.manage', 'Manage laboratory insurance and TPA claims')
ON DUPLICATE KEY UPDATE description=VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN'
ON DUPLICATE KEY UPDATE role_id=role_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p
  ON p.code IN ('lab.packages.manage','lab.accounting.view','lab.accounting.manage','lab.data.export','lab.report.share','lab.tpa.manage')
WHERE r.code IN ('ADMIN','LAB_ADMIN')
ON DUPLICATE KEY UPDATE role_id=role_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p
  ON p.code IN ('lab.accounting.view','lab.data.export')
WHERE r.code='OPD_ADMIN'
ON DUPLICATE KEY UPDATE role_id=role_id;
