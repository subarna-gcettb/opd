# Chhayabithi HMS — OPD Module

A production-foundation Hospital Management System, OPD module (v1), for Chhayabithi. Built with Node.js, Express, MySQL 8, and EJS/Bootstrap 5.

See also: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DATABASE.md](./DATABASE.md) · [API.md](./API.md) · [SECURITY.md](./SECURITY.md) · [DEPLOYMENT.md](./DEPLOYMENT.md) · [PATCHING.md](./PATCHING.md)

## Requirements

- Node.js 18+
- MySQL 8+
- npm

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Notes |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Your MySQL connection |
| `SESSION_SECRET` | Long random string |
| `CSRF_SECRET` | Long random string |
| `AADHAAR_ENCRYPTION_KEY` | **Exactly 64 hex characters** (32 bytes). Generate with `openssl rand -hex 32` |
| `AADHAAR_HASH_SECRET` | Any long random string |
| `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` | Used only by the seed script, once |

Never commit `.env` — it's already in `.gitignore`.

## 3. Create the database

```sql
CREATE DATABASE chhayabithi_hms CHARACTER SET utf8mb4;
CREATE USER 'hms_app'@'%' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON chhayabithi_hms.* TO 'hms_app'@'%';
FLUSH PRIVILEGES;
```

## 4. Run migrations and seed data

```bash
node database/migrate.js
node database/seed.js
```

`migrate.js` applies every file in `database/migrations/` in order, tracked in a `schema_migrations` table, so it's safe to re-run — already-applied files are skipped. `seed.js` inserts the starter branch/departments/roles/permissions/medicines and creates a Super Admin account (credentials printed to the console once — the account is forced to change its password on first login).

## 5. Run the app

```bash
npm run dev    # nodemon, auto-restart
# or
npm start      # production-style start
```

Visit `http://localhost:4000` (or whatever `PORT` you set) and log in with the Super Admin credentials printed by the seed script.

## Running tests

```bash
npm test
```

Unit tests cover the business-rule-critical services (Health ID generation, sequence/token generation, Aadhaar encryption, the discount self-approval guard, doctor-scope authorization) using mocked database connections — no live MySQL server is required to run them.

## Project layout

```
config/       environment-driven configuration (db pool, session, auth constants)
controllers/  thin HTTP handlers — parse request, call a service, render/respond
routes/       Express routers, one per module, with validation + permission middleware
middleware/   auth, RBAC, validation, CSRF, audit-IP capture, centralized error handling
services/     all business logic and transactions live here
database/     schema.sql, seed.sql, indexes.sql, versioned migrations/, migrate.js, seed.js
views/        EJS templates, organized by module, plus views/print/ for print documents
public/       css/js/images served statically
tests/        jest unit tests
```

## Patient Portal

Patients can get their own login (staff creates it from a patient's profile page — "Create Portal Login" — using an email on file). It reuses the same `users`/`roles`/session infrastructure as staff (`users.patient_id` links the account to exactly one patient record), but every patient-portal route (`/patient-portal/*`) derives its data scope strictly from `req.user.patientId`, resolved server-side from the session — never from a URL parameter, which is what prevents one patient from ever viewing another's records. A patient sees: their own profile/barcode, upcoming appointments, completed-visit history, current prescriptions (view/print), and invoices/receipts. They cannot book, edit, or see anyone else's data.

## Email Notifications (SMTP)

Set `SMTP_HOST` (and the other `SMTP_*` variables) in `.env` to enable email notifications. Leave `SMTP_HOST` blank to disable email entirely — every notification call is best-effort and non-blocking (`services/emailService.js`), so a missing/broken SMTP config never breaks the feature that triggered it (booking, prescribing, billing, etc. all still work; only the email is skipped, with a warning logged to the console).

Notifications currently sent (all to the address on file, skipped silently if there isn't one):
- Patient: appointment booked / rescheduled / cancelled, prescription issued, invoice generated, payment received (receipt)
- Staff/doctor: account created (temporary password), password reset by admin, discount request approved/rejected

## Troubleshooting

**"Cannot connect to MySQL" on startup** — check `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` in `.env`, and that the user has privileges on that database.

**"403 invalid csrf token" right after logging in, or the app crashing on every page with `generateCsrfToken is not a function`** — both were real bugs found and fixed in this codebase already, kept here in case a future dependency bump reintroduces something similar:
- The crash was `csrf-csrf`'s exported function name differing between major versions (`generateToken` in the 3.x line this project pins vs `generateCsrfToken` in 4.x). `middleware/csrf.js` now detects whichever is actually exported.
- The "invalid csrf token after login" was caused by an (unnecessary, since removed) `getSessionIdentifier` option that made the token session-bound, so `req.session.regenerate()` on successful login — which intentionally issues a new session id, to prevent session fixation — invalidated a token that had been valid moments earlier. `authController.login` now also explicitly calls `rotateCsrfToken()` right after regenerating the session, forcing a clean token/cookie pair for the new session as a second safeguard.

**A specific interactive feature (not the whole app) silently does nothing** — e.g. clicking through the OPD booking department→doctor→slot cascade and nothing loads. Check the browser console for a Content-Security-Policy violation before anything else: several views rely on inline `<script>` blocks and `onclick=` handlers, which need `'unsafe-inline'` in `scriptSrc` (already set in `app.js`). If that directive is ever tightened, this is the first thing to check — it fails silently with no server-side error at all.

**Barcode image doesn't render** — confirm `bwip-js` installed correctly (`npm ls bwip-js`); it has no native dependencies so this is rare.

**Aadhaar-related error on patient registration** — `AADHAAR_ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes). Regenerate with `openssl rand -hex 32` if unsure.

## Backup

MySQL logical dump, run on a schedule (cron/systemd timer):

```bash
mysqldump -u hms_app -p chhayabithi_hms > backup-$(date +%F).sql
```

Verify a backup by restoring it into a scratch database periodically:

```bash
mysql -u root -p -e "CREATE DATABASE hms_restore_test"
mysql -u root -p hms_restore_test < backup-2026-09-18.sql
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production backup/restore procedure and retention guidance.
