-- Additional composite indexes, applied after schema.sql
-- (Primary/FK/unique indexes already declared inline in schema.sql;
--  these support reporting and dashboard queries specifically.)

CREATE INDEX idx_appt_branch_date_status ON appointments (branch_id, appointment_date, status);
CREATE INDEX idx_visit_branch_status_checkin ON opd_visits (branch_id, status, checked_in_at);
CREATE INDEX idx_invoice_branch_status_created ON invoices (branch_id, status, created_at);
CREATE INDEX idx_payments_paid_at ON payments (paid_at);
CREATE INDEX idx_discount_requested_at ON discount_requests (requested_at);
CREATE INDEX idx_patients_created_at ON patients (created_at);

-- Simple migration tracker (used by database/migrate.js)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(150) NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
