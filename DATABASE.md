# DATABASE.md

MySQL 8+, InnoDB, utf8mb4. Full DDL: `database/schema.sql` (also mirrored as `database/migrations/001_initial_schema.sql`). Additional composite/reporting indexes: `database/indexes.sql`.

## Table groups

**Identity / RBAC**: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions` (express-session store)

**Org structure**: `branches`, `departments`

**Patients**: `patients`, `patient_addresses` (1:1), `patient_medical_profiles` (1:1)

**Doctors**: `doctors`, `doctor_schedule_templates` (recurring weekly availability), `doctor_schedule_exceptions` (leave/holiday/special hours)

**Appointments/Visits**: `appointments`, `appointment_history` (append-only), `opd_visits`

**Consultation**: `opd_consultations`, `vitals` (1:1 with a consultation)

**Prescriptions**: `medicines` (master), `prescriptions` (versioned — see below), `prescription_items`

**Billing**: `invoices`, `invoice_items`, `payments`, `discount_requests`

**Cross-cutting**: `audit_logs`, `system_settings`, `sequence_counters`, `schema_migrations`

## Key design points

### `patients.health_id`
`CHAR(11)`, `UNIQUE`. Format `YYBBSSSSSSS` — see ARCHITECTURE.md. Generated once at registration and never updated afterward; no code path in the application issues an `UPDATE` on this column.

### Aadhaar columns on `patients`
- `aadhaar_encrypted` (`VARBINARY(512)`) — AES-256-GCM ciphertext + auth tag, from `utils/aadhaarUtil.js`
- `aadhaar_iv` (`VARBINARY(32)`) — the random IV used for that row's encryption
- `aadhaar_hash` (`CHAR(64)`) — HMAC-SHA256, deterministic, indexed, used **only** for duplicate-detection lookups server-side
- `aadhaar_last4` (`CHAR(4)`) — for masked display (`XXXX XXXX 1234`)

The raw Aadhaar number is never stored and never appears in any column.

### `prescriptions` versioning
`(prescription_code, version)` is unique. `is_current` marks the current version; exactly one row per `prescription_code` should have `is_current = 1` at any time (enforced in application code by `amendPrescription`, which flips the old row before inserting the new one in the same transaction). `amended_from_id` self-references the immediately-preceding version.

### `appointments` capacity/uniqueness
`UNIQUE (doctor_id, appointment_date, token_number)` prevents two different appointments from ever claiming the same token for the same doctor on the same day, even under concurrent booking — this is the database-level backstop behind the row-locked check in `scheduleService.isSlotBookable`.

### `sequence_counters`
`(scope_key, current_value)`, `UNIQUE(scope_key)`. Backs every generated identifier in the system (see ARCHITECTURE.md). Rows are created on first use (`INSERT ... ON DUPLICATE KEY UPDATE scope_key = scope_key`) and then locked with `SELECT ... FOR UPDATE` before incrementing, all inside the caller's transaction.

## Important indexes

Beyond primary/foreign keys, deliberately added for known query patterns:

| Index | Table | Purpose |
|---|---|---|
| `patients.mobile`, `patients.name`, `patients.aadhaar_hash` | `patients` | Patient search |
| `(doctor_id, appointment_date)`, `(appointment_date, status)` | `appointments` | Scheduling + queue lookups |
| `(doctor_id, status)` | `opd_visits` | Doctor portal queue |
| `(prescription_code, version)` unique, `(visit_id)`, `(patient_id)` | `prescriptions` | Version lookup, patient history |
| `(branch_id, appointment_date, status)` | `appointments` | Dashboard/report aggregates |
| `(branch_id, status, created_at)` | `invoices` | Billing reports |
| `(entity, entity_id)`, `(user_id)`, `(created_at)` | `audit_logs` | Audit log filtering |

## Migrations

`database/migrate.js` applies every `.sql` file in `database/migrations/`, in filename order, tracked in `schema_migrations` (one row per applied filename) so re-running is always safe. New migrations are added as `002_*.sql`, `003_*.sql`, etc. — never edit an already-shipped migration file; see [PATCHING.md](./PATCHING.md).

`002_add_patient_email_and_portal.sql` adds `patients.email` (optional, notifications/portal contact — not used for login) and `users.patient_id` (nullable, unique FK to `patients`, marking a user account as a patient-portal login), plus the `PATIENT` role and `patient.portal.access` permission.
