# PATCHING.md

This project is built to be extended through isolated patches, not rewrites. Read this before adding Laboratory, Pharmacy, Diagnostics, Advanced Billing, or any other future module.

## Rules

1. **Never edit a migration file that has already shipped.** Add a new one: `database/migrations/00N_description.sql`, numbered after the highest existing file. `database/migrate.js` tracks applied filenames in `schema_migrations` and will run only the new one.
2. **New tables reference `patient_id` and/or `visit_id`** on the existing `patients`/`opd_visits` tables. Do not add columns to `patients`, `opd_visits`, `prescriptions`, or `invoices` unless absolutely necessary — prefer a new table with a foreign key.
3. **One module, one set of files**: its own `services/xyzService.js`, `controllers/xyzController.js`, `routes/xyzRoutes.js`, `views/xyz/*.ejs`. Mount the new router in `app.js` with its own path prefix. Don't scatter its logic into existing files.
4. **Reuse `sequenceService`** for any new identifier the module needs (lab order number, pharmacy sale number, etc.) — don't write a new locking scheme.
5. **Reuse `auditService.log(...)`** for every mutating action in the new module, inside the same transaction as the change it documents.
6. **Follow the existing permission pattern**: add new permission codes to `seed.sql`'s `permissions` table and to the relevant roles in `role_permissions`, then gate routes with `requirePermission('newmodule.action')`.
7. **Soft-delete master data** (`deleted_at DATETIME NULL`), never hard-delete, matching `patients`/`doctors`/`users`.

## Example: adding the Laboratory module

```
database/migrations/002_add_laboratory.sql
  laboratories(id, name, branch_id, ...)
  lab_workers(id, user_id, laboratory_id, ...)
  lab_tests(id, name, price, ...)            -- test master
  lab_orders(id, order_code UNIQUE, visit_id, patient_id, ordered_by, status, ...)
  lab_order_items(id, lab_order_id, lab_test_id, ...)
  lab_results(id, lab_order_item_id, result_value, reported_by, reported_at, ...)

services/labService.js       -- order creation, sample tracking, result entry (all transactional)
controllers/labController.js
routes/labRoutes.js           -- mounted at app.use('/lab', ...)
views/lab/*.ejs

Patient profile page (views/patients/profile.ejs):
  add a "Lab Reports" tab that queries lab_orders/lab_results by patient_id,
  the same pattern as the existing OPD History / Prescriptions / Billing tabs.
```

No change is required to `patients`, `opd_visits`, `appointments`, `prescriptions`, or `invoices` to support this — `lab_orders.visit_id` is enough to tie a lab order to the OPD visit that requested it, and `lab_orders.patient_id` is enough to show it on the patient's permanent record regardless of which visit it came from.

## Example: adding Pharmacy

`prescription_items.medicine_id` already exists (nullable FK to `medicines`) specifically so the Pharmacy patch can link a dispensed sale back to an exact prescribed item without any change to the `prescriptions`/`prescription_items` tables:

```
database/migrations/003_add_pharmacy.sql
  suppliers(...)
  medicine_stock(id, medicine_id, batch_no, expiry_date, quantity, ...)
  pharmacy_purchases(...)
  pharmacy_sales(id, sale_code UNIQUE, patient_id, prescription_id NULL, sold_by, ...)
  pharmacy_sale_items(id, pharmacy_sale_id, medicine_id, quantity, price, ...)
```

## Example: Advanced Billing (insurance, packages, refunds)

Extend `invoice_items.item_type` (currently `CONSULTATION`/`OTHER`) with new values (`LAB`, `PHARMACY`, `DIAGNOSTIC`, `PACKAGE`, `INSURANCE`) rather than creating a parallel invoicing system. Add `insurance_claims`/`refunds` tables that reference `invoice_id` — the existing `invoices`/`payments`/`discount_requests` workflow (including the self-approval guard) keeps working unmodified.

## Testing a patch

Add unit tests under `tests/unit/` for the new service's transactional logic, following the pattern in `tests/unit/billingService.test.js` (mock `config/database` with a fake `withTransaction`/connection rather than requiring a live MySQL server for every business-rule test). Add authorization tests confirming the new module's routes reject users without the new permission, following `tests/unit/roles.middleware.test.js`.

## Rolling back a patch

Because migrations are additive-only by convention (new tables, nullable new columns), rolling back is almost always "stop routing to the new module's routes and leave the tables in place" rather than a destructive down-migration. If a genuine schema rollback is ever required, write it as its own forward migration that undoes the change (e.g. `004_revert_lab_module.sql`) rather than editing history.
