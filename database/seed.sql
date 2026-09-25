-- Development / initial seed data.
-- Super Admin user is created by database/seed.js (needs bcrypt hashing),
-- NOT here in plain SQL.

INSERT INTO branches (code, name, address, phone, email, is_active)
VALUES ('01', 'Chhayabithi - Berhampore', '136/1 Abdus Samad Road, Gorabazar, Berhampore, Murshidabad', '+91 787 8900 200', 'info@chhayabithi.com', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO departments (name, is_active) VALUES
  ('General Medicine', 1),
  ('General Surgery', 1),
  ('Pediatrics', 1),
  ('Gynecology', 1),
  ('Orthopedics', 1),
  ('ENT', 1),
  ('Dermatology', 1),
  ('Neurosurgery', 1),
  ('Cardiology', 1),
  ('Dental', 1)
ON DUPLICATE KEY UPDATE is_active = VALUES(is_active);

INSERT INTO roles (code, name) VALUES
  ('SUPER_ADMIN', 'Super Admin'),
  ('ADMIN', 'OPD Admin'),
  ('OPD_STAFF', 'OPD Staff / Receptionist'),
  ('DOCTOR', 'Doctor')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO permissions (code, description) VALUES
  ('patient.create', 'Register new patients'),
  ('patient.view', 'View patient profiles'),
  ('patient.edit', 'Edit patient information'),
  ('patient.suspend', 'Suspend or restore a patient record without deleting medical history'),
  ('appointment.create', 'Book OPD appointments'),
  ('appointment.reschedule', 'Reschedule appointments'),
  ('appointment.cancel', 'Cancel appointments'),
  ('queue.manage', 'Manage OPD queue / call patients'),
  ('consultation.create', 'Record doctor consultation'),
  ('prescription.create', 'Create prescriptions'),
  ('prescription.amend', 'Amend/version prescriptions'),
  ('billing.create', 'Generate invoices'),
  ('billing.view', 'View billing information'),
  ('payment.record', 'Record payments'),
  ('discount.request', 'Request a billing discount'),
  ('discount.approve', 'Approve or reject discount requests'),
  ('doctor.manage', 'Create/edit doctor records'),
  ('doctor.schedule.manage', 'Manage doctor schedules'),
  ('branch.manage', 'Manage branches'),
  ('department.manage', 'Manage departments'),
  ('user.manage', 'Manage users and roles'),
  ('report.view', 'View reports'),
  ('audit.view', 'View audit logs'),
  ('settings.manage', 'Configure hospital settings')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Role -> permission mapping
-- SUPER_ADMIN: everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'SUPER_ADMIN'
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ADMIN: OPD operations, no discount approval / user management / settings
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('patient.create','patient.view','patient.suspend','patient.edit','patient.suspend',
                'appointment.create','appointment.reschedule','appointment.cancel',
                'queue.manage','billing.create','billing.view','payment.record',
                'discount.request','report.view')
WHERE r.code = 'ADMIN'
ON DUPLICATE KEY UPDATE role_id = role_id;

-- OPD_STAFF: registration, search, booking, normal billing only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('patient.create','patient.view',
                'appointment.create','appointment.reschedule',
                'queue.manage','billing.create','billing.view','payment.record',
                'discount.request')
WHERE r.code = 'OPD_STAFF'
ON DUPLICATE KEY UPDATE role_id = role_id;

-- DOCTOR: clinical + own-scope only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('patient.view','consultation.create','prescription.create',
                'prescription.amend','discount.request','queue.manage')
WHERE r.code = 'DOCTOR'
ON DUPLICATE KEY UPDATE role_id = role_id;

-- Starter medicine master (extend freely; Pharmacy patch will expand this)
INSERT INTO medicines (name, strength, form) VALUES
  ('Paracetamol', '500mg', 'Tablet'),
  ('Amoxicillin', '500mg', 'Capsule'),
  ('Azithromycin', '500mg', 'Tablet'),
  ('Omeprazole', '20mg', 'Capsule'),
  ('Cetirizine', '10mg', 'Tablet'),
  ('Metformin', '500mg', 'Tablet'),
  ('Amlodipine', '5mg', 'Tablet'),
  ('ORS', 'Standard', 'Sachet')
ON DUPLICATE KEY UPDATE is_active = 1;
