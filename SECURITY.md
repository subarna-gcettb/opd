# SECURITY.md

## Authentication
- Passwords hashed with bcrypt (cost 12), never logged, never returned in any response.
- Sessions stored server-side in MySQL (`sessions` table via `express-mysql-session`), not in memory — safe across restarts and multiple app instances.
- Session cookie: `httpOnly`, `sameSite: 'lax'`, `secure: true` in production.
- Session is regenerated on successful login (fixation protection).
- Failed logins are counted per account; after `maxFailedLoginAttempts` (default 5) the account locks for `lockoutDurationMs` (default 15 minutes) — see `config/auth.js`.
- Login is additionally rate-limited per IP via `express-rate-limit`.

## Authorization
- Permission-based RBAC (`middleware/roles.js`), resolved from `roles`/`permissions`/`role_permissions`/`user_roles` — see ARCHITECTURE.md.
- **Doctor-scope IDOR guard**: a doctor cannot open another doctor's visit/consultation/prescription by guessing its ID — enforced in `consultationService.assertDoctorCanAccessVisit` and `prescriptionService.assertCanAmend`, not just by hiding the link in the UI.
- **Patient-portal scope guard**: every `/patient-portal/*` route resolves its data strictly from `req.user.patientId` (set server-side in `middleware/auth.js` from `users.patient_id`), never from a URL parameter — `patientPortalController` additionally double-checks `data.prescription.patient_id === patientId` / `data.invoice.patient_id === patientId` before rendering, so even a coding mistake in the route-to-service wiring can't leak another patient's record.
- **Discount self-approval guard**: enforced at the service layer (`billingService.decideDiscount`) regardless of the actor's permissions.

## CSRF
Double-submit-cookie pattern via `csrf-csrf`. Every state-changing form includes a hidden `_csrf` field; `middleware/csrf.js` is written to tolerate the exported-function-name differences between `csrf-csrf` major versions (see the README troubleshooting section — this exact mismatch caused a full-app outage once and is worth knowing about if the dependency is ever upgraded).

## Input validation
`express-validator` chains on every route that accepts user input (`routes/*.js`), collected by `middleware/validation.js`. Client-side `pattern`/`required` attributes exist for UX only; server-side validation is authoritative and re-checks everything.

## SQL injection
100% parameterized queries via `mysql2`'s named-placeholder support (`pool.execute(sql, { ... })`). No string-concatenated SQL anywhere in the codebase.

## XSS
EJS auto-escapes `<%= %>` output by default; the codebase does not use the unescaped `<%- %>` form on any user-supplied field. A Content-Security-Policy is set via Helmet. Note: the CSP intentionally allows `'unsafe-inline'` for scripts because several views use inline `<script>` blocks for client-side interactivity (booking cascade, dynamic prescription rows) — this is a deliberate trade-off for a server-rendered EJS app rather than a SPA; if hardening further, migrate those inline scripts to external files with a nonce-based CSP instead of removing `'unsafe-inline'` outright (removing it without the migration will silently break that JS).

## Aadhaar handling
- Raw Aadhaar is never stored; encrypted at rest (AES-256-GCM, `utils/aadhaarUtil.js`), key from `AADHAAR_ENCRYPTION_KEY` (never hard-coded).
- A separate deterministic HMAC hash (`AADHAAR_HASH_SECRET`) is used only for server-side duplicate-patient detection — never returned to the client.
- Only the last 4 digits are ever displayed, masked as `XXXX XXXX 1234`.
- Never appears in a URL, barcode, log line, or error message — enforced by never passing the raw value or the encrypted/hash columns into any response-serialization path (`patientService.getPatientProfile` explicitly strips them before returning).

## Reception-Registered Patient Portal Accounts

When a receptionist registers a new patient with an email address, a patient-portal account is created automatically (no separate step needed) using a **fixed, documented password pattern**:

```
<first word of hospital name>@<last 4 digits of the patient's mobile number>
```

e.g. a patient with mobile `98765xxxxx` at "Chhayabithi" gets the temporary password `Chhayabithi@xxxx`. This is deliberately simple and predictable, per an explicit requirement that the pattern be fixed and reproducible for staff. **Security tradeoff, stated plainly**: anyone who knows both the hospital's name and a specific patient's mobile number (e.g. a family member, or someone who saw the registration slip) can compute this password. The mitigations in place:
- `must_reset_password` is always `1` on these accounts — the patient is forced to set their own password on first login, so the generated password only has a window of validity until then.
- It is never logged anywhere; it's only shown once in the receptionist's success message and emailed directly to the patient.
- If this tradeoff is unacceptable for a given deployment, the fix is to stop auto-creating the account at registration and instead always use the manual "Create Portal Login" button on the patient profile, which still defaults to this pattern unless a different `temporaryPassword` is explicitly supplied — see `patientPortalService.generateDefaultPassword` / `createPortalAccount`.

## Barcode / patient lookup
Barcodes encode the Health ID only — never diagnosis, medicines, or Aadhaar. Scanning resolves through an authenticated route (`GET /prescriptions/scan`); there is no public lookup URL.

## Audit logging
Every mutating service call writes an `audit_logs` row (`services/auditService.js`), which explicitly scrubs any accidentally-included `password`/`password_hash`/`aadhaar*` fields before serializing `old_value`/`new_value` to JSON, as defense in depth even though callers shouldn't be passing those fields in the first place.

## Error handling
`middleware/errorHandler.js` never sends stack traces, SQL text, credentials, or filesystem paths to the client in production (`NODE_ENV=production`); those are logged server-side only. In development, the response can include a stack trace under a `showDetails` flag purely for local debugging — do not set `NODE_ENV=production` off in a real deployment.

## Reporting a problem
There's no live bug bounty program for this internal system; report issues directly to whoever owns deployment/ops for the hospital's instance.
