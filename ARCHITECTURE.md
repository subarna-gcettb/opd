# ARCHITECTURE.md

## Layers

```
views (EJS)  ->  controllers (thin)  ->  services (business logic + transactions)  ->  mysql2 pool
                       ^
                 routes + middleware (auth, RBAC, validation, CSRF, audit)
```

- **Controllers never contain SQL or transaction logic.** They parse `req`, call a service function, and render or redirect.
- **Services own every transaction.** Any operation touching more than one table that must succeed or fail together (patient registration, appointment booking, discount approval, payment) is wrapped in `withTransaction` from `config/database.js`.
- **Routes wire permission checks, not controllers.** `requirePermission('x.y')` / `requireRole(...)` are applied per-route in `routes/*.js`, so the full set of who-can-do-what for any endpoint is visible in one file per module.

## Identifiers

Every identifier in the system is generated through one shared primitive, `services/sequenceService.js`: a row-locked (`SELECT ... FOR UPDATE`) counter in `sequence_counters`, keyed by a `scope_key` string. This is what makes Health IDs, registration numbers, appointment codes, visit codes, prescription codes, invoice numbers, payment codes, receipt numbers, and per-doctor-per-day tokens all concurrency-safe without each having bespoke locking logic.

- `services/healthIdService.js` builds the Health ID (`YYBBSSSSSSS`) on top of this primitive, scoped by `healthid:{year}:{branchCode}`.
- Tokens are scoped by `token:doctor:{doctorId}:{date}` — this is *why* two different doctors can both have "Token 001" on the same day: they're different scope keys.
- Every generated code also has a database-level `UNIQUE` constraint as a final backstop; `patientService.registerPatient` specifically retries (up to 3 times) on a Health-ID unique-constraint race, rather than assuming the row lock alone is sufficient.

## Appointment vs. Visit — two separate state machines

An **appointment** (`BOOKED → RESCHEDULED/CANCELLED/NO_SHOW/COMPLETED`) represents *intent to visit*. A **visit** (`WAITING → CALLED → IN_CONSULTATION → COMPLETED/CANCELLED`) represents the patient's actual physical progress through the OPD that day. They are deliberately different tables (`appointments`, `opd_visits`) with different status enums and different transition rules (`opdService.updateVisitStatus` enforces a `VISIT_TRANSITIONS` map; you cannot jump from `WAITING` straight to `COMPLETED`).

This separation is what lets Lab/Pharmacy/Diagnostics attach to a stable `visit_id` later without caring whether the *appointment* was rescheduled three times to get there.

## Authorization model

RBAC is **permission**-based, not role-based, in the code: `roles` and `permissions` are both database tables, joined through `role_permissions`. Granting `ADMIN` the ability to approve discounts later is a data change (`seed.sql` or the admin UI), never a code change — `middleware/roles.js` only ever checks permission *codes*.

Two authorization checks are enforced at the service layer, not just hidden by menu visibility in the UI, because hiding a link is not a security boundary:
- **Doctor scope (IDOR guard)**: `services/consultationService.js#assertDoctorCanAccessVisit` and `services/prescriptionService.js#assertCanAmend` refuse a doctor access to a visit/prescription that isn't theirs, even if they know the raw visit/prescription ID. Only `SUPER_ADMIN` bypasses this.
- **Discount self-approval guard**: `services/billingService.js#decideDiscount` checks `request.requested_by === actorUserId` and throws regardless of what permissions the actor holds. A Super Admin who filed their own discount request still cannot approve it themselves.

## Prescription versioning (never overwritten)

`prescriptions.is_current` + `version` + `amended_from_id` implement append-only correction: `amendPrescription` flips the old row to `is_current = 0` and inserts a new row at `version + 1`. Nothing is ever `UPDATE`d or `DELETE`d on a finalized prescription. The same append-only principle applies to `appointment_history` (reschedules/cancellations never overwrite the appointment's prior date/time) and to `audit_logs` (write-only).

## Barcode

`services/barcodeService.js` generates a Code128 barcode encoding **only** the patient's Health ID — never diagnosis, medicines, or Aadhaar. Scanning it hits `GET /prescriptions/scan?code=...`, an authenticated route behind `requirePermission('patient.view')`; there is no public/unauthenticated barcode-lookup URL anywhere in the system.

## Future modules (Lab, Pharmacy, Diagnostics, Advanced Billing)

Every future module attaches to the existing core via `patient_id` and/or `visit_id` foreign keys on **new** tables — nothing in `patients`, `opd_visits`, `prescriptions`, or `invoices` needs to change. See [PATCHING.md](./PATCHING.md) for the concrete shape each future module is expected to take and how to ship it as an isolated migration.
