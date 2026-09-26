# Chhayabithi Hospital Management System — OPD

Production-oriented Hospital Management System (HMS) focused on the Out-Patient Department (OPD) workflow for **Chhayabithi**.

The project provides a public clinic website, staff/admin OPD operations, doctor consultation workflow, patient self-service portal, appointment/queue management, billing and payments, prescriptions, notifications, audit/security controls, printable documents, and live OPD status.

> **Repository:** `subarna-gcettb/opd`  
> **Default branch:** `main`

---

## 1. What is included

### Public hospital website

- Hospital landing page
- Responsive healthcare design
- Services page
- Doctors page
- Laboratory & diagnostics page
- Patient portal information page
- Contact page
- Public Live OPD board
- Patient Sign Up / Sign In
- Healthcare photography using free-use Pexels images
- Mobile/PWA support

### OPD workflow

1. Patient registration/search
2. Appointment booking
3. Doctor assignment and scheduling
4. OPD token generation
5. Receptionist queue management
6. Receptionist vitals entry
7. Doctor consultation
8. Prescription creation
9. Billing and payment
10. Discount/complementary approval workflow
11. Receipt/print documents
12. Appointment notifications
13. Patient portal access
14. Public live OPD queue

### Patient portal

Patients can:

- Create an account with email OTP verification
- Sign in with:
  - Email + password
  - Mobile + password
  - Health ID + password
  - Email + OTP
  - Google Sign-In (optional)
- Reset password using email OTP
- View their own profile
- View their Health ID/barcode
- View upcoming appointments
- View completed visit history
- View prescriptions
- Print prescriptions
- View invoices and receipts

Patient routes are scoped from the authenticated session and patient account rather than accepting another patient's ID from the URL.

### Pregnancy / obstetric appointment support

For applicable appointments the system can store:

- LMP date
- Gravida
- Para
- Abortions
- Pregnancy status
- Gestational age
- Estimated due date
- Obstetric notes

Gestational age and EDD are calculated from the LMP and appointment date.

### Queue management

Reception staff can:

- See the current OPD queue
- Move waiting patients up/down
- Keep the permanent token number unchanged
- Use a separate `queue_position` for ordering

The public Live OPD board follows the receptionist-controlled queue order.

### Billing

The project supports:

- Invoice generation
- Cash
- UPI
- Card
- Discount workflow
- Doctor-requested complementary/100% discount
- Super Admin approval
- Payment receipts
- Unpaid-bill handling after consultation

### Notifications

SMTP email notifications are best-effort and non-blocking.

Current notification areas include:

- Appointment booked
- Appointment rescheduled
- Appointment cancelled
- Prescription issued
- Invoice generated
- Payment received / receipt
- Staff/doctor account created
- Admin password reset
- Discount request approved/rejected
- Patient signup OTP
- Patient login OTP
- Password reset OTP

---

# 2. Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Backend | Express.js 4 |
| Frontend | EJS, HTML5, CSS3, JavaScript |
| UI | Bootstrap 5 / custom CSS |
| Database | MySQL 8+ |
| Authentication | Express Session + MySQL session store |
| Password hashing | bcrypt |
| Validation | express-validator |
| CSRF | csrf-csrf |
| Security headers | Helmet |
| Rate limiting | express-rate-limit |
| Email | Nodemailer / SMTP |
| PDF | PDFKit |
| Barcode | bwip-js |
| Uploads | Multer |
| Compression | compression |
| Tests | Jest + Supertest |
| Production process | PM2 |
| Reverse proxy | Nginx |

---

# 3. Requirements

Install the following before starting:

- Node.js **18 or newer**
- npm
- MySQL **8 or newer**
- Git

Recommended production environment:

- Ubuntu/Debian Linux
- Nginx
- PM2
- HTTPS/TLS
- Regular MySQL backups

Check your installed versions:

```bash
node --version
npm --version
mysql --version
git --version
```

---

# 4. Clone the project

```bash
git clone https://github.com/subarna-gcettb/opd.git
cd opd
```

Make sure you are using the complete `main` branch:

```bash
git checkout main
git pull origin main
```

You can confirm the branch with:

```bash
git branch --show-current
git log -1 --oneline
```

---

# 5. Install dependencies

For development:

```bash
npm install
```

For production:

```bash
npm install --omit=dev
```

---

# 6. Configure environment variables

Create your local environment file:

```bash
cp .env.example .env
```

Open it:

```bash
nano .env
```

## Required database configuration

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=hms_app
DB_PASSWORD=your-database-password
DB_NAME=chhayabithi_hms
```

## Application configuration

```env
PORT=4000
NODE_ENV=development
APP_TIMEZONE=Asia/Kolkata
SESSION_SECRET=replace-with-a-long-random-secret
CSRF_SECRET=replace-with-another-long-random-secret
```

Generate strong secrets instead of using examples:

```bash
openssl rand -hex 32
```

## Aadhaar protection

The application uses encrypted/hash-protected Aadhaar handling.

```env
AADHAAR_ENCRYPTION_KEY=
AADHAAR_HASH_SECRET=
```

Generate the encryption key with:

```bash
openssl rand -hex 32
```

The resulting value is exactly **64 hexadecimal characters**.

Do not change `AADHAAR_ENCRYPTION_KEY` after production data has been encrypted unless you have a controlled re-encryption migration.

## SMTP configuration

Required for patient email OTP and email notifications:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_EMAIL=no-reply@example.com
SMTP_FROM_NAME=Chhayabithi HMS
```

If `SMTP_HOST` is empty, email is disabled and notification failures do not stop the main OPD operation.

## Optional Google Sign-In

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
```

For production, change the callback URL to your HTTPS domain.

> Never commit `.env`. It is intentionally ignored by Git.

---

# 7. Create the MySQL database

Log into MySQL:

```bash
sudo mysql
```

Create a dedicated application database and user:

```sql
CREATE DATABASE chhayabithi_hms
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'hms_app'@'localhost'
  IDENTIFIED BY 'CHANGE_THIS_TO_A_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE
ON chhayabithi_hms.*
TO 'hms_app'@'localhost';

FLUSH PRIVILEGES;
EXIT;
```

Update the same credentials in `.env`.

For a development database where the app needs broader privileges for migrations, use the database account appropriate for your environment. In production, prefer least privilege.

---

# 8. Run database migrations

The migration runner applies the versioned SQL files in:

```
database/migrations/
```

Run:

```bash
npm run migrate
```

Equivalent command:

```bash
node database/migrate.js
```

The migration system records applied migrations in `schema_migrations`, so already-applied migrations are skipped.

### Important migration areas

The current migration set includes the core OPD schema plus later enhancements such as:

- OPD usability/security improvements
- Patient portal authentication
- Patient-to-user account linking
- Patient OTP storage
- Pregnancy/obstetric appointment fields
- Queue positions
- Receptionist vitals
- Related indexes and permissions

After pulling a newer version of the project, always run:

```bash
npm run migrate
```

before starting the production application.

---

# 9. Seed the initial system data

Run the seed script:

```bash
npm run seed
```

Equivalent:

```bash
node database/seed.js
```

The seed process initializes the application's starter data such as:

- Branch
- Departments
- Roles
- Permissions
- Role permissions
- Medicines/reference data
- Super Admin account

The seed script prints the initial Super Admin credentials to the console.

### First login

1. Start the application.
2. Open the application URL.
3. Sign in with the Super Admin credentials printed by the seed process.
4. Change the initial password immediately.
5. Do not store the temporary password in source code or commit it to Git.

Run the seed only when you understand its intended initialization behavior. For subsequent deployments, normally run migrations rather than reseeding the production database.

---

# 10. Start the application

## Development

```bash
npm run dev
```

This starts the server with Nodemon.

## Normal start

```bash
npm start
```

The application normally runs on:

```
http://localhost:4000
```

If you change `PORT`, use that port instead.

---

# 11. First-time setup checklist

After the application opens:

1. Log in as Super Admin.
2. Change the initial password.
3. Verify the hospital name/contact/settings.
4. Verify branch configuration.
5. Verify departments.
6. Create/configure doctors.
7. Create receptionist/OPD staff accounts.
8. Configure doctor schedules.
9. Configure OPD fees.
10. Configure discount approval permissions.
11. Configure SMTP.
12. Send a test email.
13. Register a test patient.
14. Create a test appointment.
15. Verify token generation.
16. Verify receptionist queue.
17. Enter receptionist vitals.
18. Complete a test doctor consultation.
19. Generate a prescription.
20. Verify invoice/payment flow.
21. Verify receipt generation.
22. Verify patient portal login.
23. Verify public Live OPD.
24. Remove test records according to the hospital's data policy before production use.

---

# 12. Main user roles

The application uses role-based access control.

### SUPER ADMIN

Full administrative control, including sensitive configuration and approval operations.

Typical responsibilities:

- User/role management
- Hospital configuration
- Permissions
- Discount/complementary approvals
- Administrative oversight
- Reports/configuration

### ADMIN / OPD ADMIN

Operational administration of the OPD module.

### OPD STAFF / RECEPTIONIST

Front-desk workflow:

- Patient registration
- Patient search
- Appointment management
- Queue management
- Vitals
- Billing/payment operations allowed by permissions

### DOCTOR

Clinical workflow:

- View assigned appointments
- View patient/appointment context
- View receptionist vitals
- View pregnancy/obstetric context when available
- Conduct consultation
- Create prescriptions
- Request applicable discounts/complementary billing

### PATIENT

Self-service portal access:

- Own profile
- Own appointments
- Own visit history
- Own prescriptions
- Own invoices/receipts

Patient access is intentionally scoped to the authenticated patient account.

---

# 13. Important public routes

The public clinic site includes:

| Route | Purpose |
|---|---|
| `/` | Hospital landing page |
| `/patient-portal-info` | Patient portal information |
| `/services` | Services |
| `/our-doctors` | Doctors |
| `/lab-diagnostics` | Laboratory/diagnostics |
| `/live-opd` | Public Live OPD board |
| `/contact` | Contact information |
| `/auth/login` | Sign in |

Patient authentication is handled under `/auth/*`, while authenticated patient services are under `/patient-portal/*`.

---

# 14. Patient registration and authentication

A patient can be created through the staff OPD workflow or through the patient self-registration flow.

## Patient self-registration

The patient:

1. Opens Sign Up.
2. Enters the required details.
3. Receives an email OTP.
4. Verifies the OTP.
5. Completes account creation.
6. Can then sign in using the supported login methods.

## Login methods

Supported patient login methods include:

- Email + password
- Mobile + password
- Health ID + password
- Email + OTP
- Google Sign-In, when configured

## Password reset

The patient requests a reset and receives an email OTP.

---

# 15. Health ID and patient identity

The Health ID is intended to be:

- Unique
- Permanent
- Never reused
- Independent of the doctor
- Used to identify the patient across visits

Do not manually change a production patient's Health ID unless there is a controlled data-correction procedure.

---

# 16. OPD appointment workflow

Typical workflow:

```
Patient
   ↓
Registration / Search
   ↓
Appointment
   ↓
Doctor + Date + Time
   ↓
OPD Visit / Token
   ↓
Reception Queue
   ↓
Vitals
   ↓
Doctor Consultation
   ↓
Prescription
   ↓
Invoice
   ↓
Payment
   ↓
Receipt
```

For applicable female/pregnancy appointments, obstetric information is captured and calculated as part of the appointment workflow.

---

# 17. Reception queue workflow

The receptionist can control the waiting order without changing the patient's permanent token number.

Conceptually:

```
Permanent token = patient visit identifier
Queue position  = current waiting order
```

This allows a patient to move up/down the queue while keeping the original token intact.

The public Live OPD board uses the current queue position for upcoming patients.

---

# 18. Receptionist vitals

Before consultation, staff can record:

- Blood pressure
- Pulse
- SpO₂
- Temperature
- Height
- Weight
- Respiratory rate
- Pain score

The doctor consultation workflow can display the recorded vitals.

---

# 19. Billing and discounts

The billing workflow supports:

- Invoice generation
- Cash payment
- UPI payment
- Card payment
- Discounts
- Complementary/100% discount requests
- Approval-controlled discounts
- Payment receipts

Doctors can request applicable discounts/complementary billing, while the configured approval workflow prevents unauthorized self-approval.

---

# 20. Email notifications

The email service is intentionally best-effort.

If SMTP is unavailable:

- The OPD action should still complete.
- The notification is skipped/logged.
- The main request is not made dependent on successful email delivery.

Configure SMTP in `.env` before production.

---

# 21. Testing

Run the test suite:

```bash
npm test
```

The repository contains Jest tests for business-critical areas including:

- Health ID generation
- Token/sequence generation
- Aadhaar encryption
- Discount self-approval protection
- Doctor-scope authorization

Tests use mocked database connections where applicable, so the unit test suite does not require a live production database.

Before a production deployment, also perform manual end-to-end smoke testing against a staging database.

---

# 22. Project structure

```
opd/
├── app.js
├── server.js
├── package.json
├── .env.example
│
├── config/
│   └── database/session/application configuration
│
├── controllers/
│   └── HTTP request handlers
│
├── routes/
│   └── Express route modules
│
├── middleware/
│   └── auth, RBAC, CSRF, validation, audit, errors
│
├── services/
│   └── business logic and database transactions
│
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   ├── indexes.sql
│   ├── migrate.js
│   ├── seed.js
│   └── migrations/
│
├── views/
│   ├── auth/
│   ├── dashboard/
│   ├── opd/
│   ├── patients/
│   ├── patient-portal/
│   ├── public/
│   ├── admin/
│   └── print/
│
├── public/
│   ├── css/
│   ├── js/
│   ├── images/
│   └── sw.js
│
├── tests/
│
├── API.md
├── ARCHITECTURE.md
├── DATABASE.md
├── DEPLOYMENT.md
├── PATCHING.md
└── SECURITY.md
```

---

# 23. Production deployment

For a production server, see:

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [SECURITY.md](./SECURITY.md)
- [DATABASE.md](./DATABASE.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

Recommended production architecture:

```
Internet
   ↓
HTTPS / Nginx
   ↓
Node.js / Express
   ↓
MySQL
```

Use PM2 to keep the application running.

Example:

```bash
npm install --omit=dev
npm run migrate
pm2 start server.js --name hms-opd
pm2 save
```

For a production environment, set:

```env
NODE_ENV=production
```

HTTPS is required when secure cookies are enabled.

---

# 24. Production update procedure

When new code is merged into `main`:

```bash
cd /var/www/hms

git checkout main
git pull origin main

npm install --omit=dev

node database/migrate.js

pm2 reload hms-opd
```

Then verify:

1. Home page
2. Login
3. Patient search
4. Appointment creation
5. Queue
6. Vitals
7. Doctor consultation
8. Billing
9. Patient portal
10. Live OPD
11. Email notifications

Do not run `git reset --hard` on a production server unless you have confirmed exactly what local changes will be discarded.

---

# 25. Database backup

Create a logical backup:

```bash
mysqldump -u hms_app -p chhayabithi_hms > backup-$(date +%F).sql
```

Compressed backup:

```bash
mysqldump -u hms_app -p chhayabithi_hms | gzip > backup-$(date +%F).sql.gz
```

Restore example:

```bash
mysql -u root -p -e "CREATE DATABASE hms_restore_test"
mysql -u root -p hms_restore_test < backup-2026-09-18.sql
```

For compressed backups:

```bash
gunzip -c backup-2026-09-18.sql.gz | mysql -u root -p hms_restore_test
```

Keep production backups outside the application server as well.

---

# 26. Security checklist

Before production:

- [ ] HTTPS enabled
- [ ] Strong `SESSION_SECRET`
- [ ] Strong `CSRF_SECRET`
- [ ] Strong `AADHAAR_ENCRYPTION_KEY`
- [ ] Strong `AADHAAR_HASH_SECRET`
- [ ] `.env` not committed
- [ ] Database user is not root
- [ ] Database credentials are unique
- [ ] Production `NODE_ENV=production`
- [ ] SMTP credentials are private
- [ ] Google OAuth credentials are private
- [ ] Initial Super Admin password changed
- [ ] Least-privilege permissions reviewed
- [ ] Backups configured
- [ ] Backups tested by restoration
- [ ] PM2/Nginx logs monitored
- [ ] Server OS updated
- [ ] Patient data access tested between different accounts
- [ ] Discount approval permissions tested
- [ ] Audit/security configuration reviewed

Never put Aadhaar numbers, passwords, SMTP credentials, API secrets, or session secrets into Git commits, screenshots, issue comments, or frontend JavaScript.

---

# 27. Troubleshooting

## MySQL connection error

Check:

```bash
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p "$DB_NAME"
```

Then verify:

- MySQL is running
- Database exists
- User exists
- Password is correct
- User has privileges
- `.env` is loaded

---

## Migration error

Check the migration that failed:

```bash
ls database/migrations
```

Then inspect the migration history table:

```sql
SELECT * FROM schema_migrations ORDER BY id;
```

Do not manually delete migration records unless you understand the schema state and have a recovery plan.

---

## CSRF error after login

The application intentionally regenerates the session after successful authentication to reduce session-fixation risk.

If you see a CSRF error immediately after login:

1. Clear the browser cookies for the application.
2. Log in again.
3. Check server logs.
4. Confirm the configured CSRF/session secrets are stable.
5. Do not regenerate `SESSION_SECRET` on every restart.

The project contains compatibility handling for the `csrf-csrf` API used by the pinned dependency version.

---

## Interactive page does nothing

If an OPD cascade, button, or modal does nothing:

1. Open browser developer tools.
2. Check the Console.
3. Look for Content-Security-Policy errors.
4. Check the Network tab.
5. Verify the relevant API request returns successfully.
6. Check the Node.js server log.

Some existing views use inline JavaScript, so CSP changes must be made carefully.

---

## Barcode is not rendering

Verify the package:

```bash
npm ls bwip-js
```

Then check the server log for barcode-generation errors.

---

## Aadhaar encryption error

Verify:

```bash
echo -n "$AADHAAR_ENCRYPTION_KEY" | wc -c
```

It must contain a 64-character hexadecimal key.

Generate a new development key with:

```bash
openssl rand -hex 32
```

Do not replace a production encryption key without a planned data re-encryption process.

---

## Email OTP is not arriving

Check:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM_EMAIL`
- Spam/junk folder
- SMTP provider logs
- Node.js application logs

A missing SMTP configuration does not intentionally block the main OPD operation.

---

# 28. Useful npm commands

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production-style server
npm start

# Apply database migrations
npm run migrate

# Seed initial data
npm run seed

# Run tests
npm test
```

---

# 29. Documentation map

| File | Purpose |
|---|---|
| `README.md` | Complete setup and operational guide |
| `ARCHITECTURE.md` | Application architecture |
| `DATABASE.md` | Database design and schema notes |
| `API.md` | API/route documentation |
| `SECURITY.md` | Security design and controls |
| `DEPLOYMENT.md` | Linux/Nginx/PM2 production deployment |
| `PATCHING.md` | Database/code patching guidance |

Read the README first, then the architecture/database/security documents before making major production changes.

---

# 30. Git workflow

Use `main` as the integrated production-ready branch.

Pull the latest code:

```bash
git checkout main
git pull origin main
```

Create a feature branch for new work:

```bash
git checkout -b feature/my-change
```

After development:

```bash
git add .
git commit -m "feat: describe the change"
git push -u origin feature/my-change
```

Merge the reviewed change into `main`.

After merging, production should be updated from `main` and migrations should be executed before restarting the application.

---

# 31. Current main branch

The `main` branch contains the integrated OPD project and the latest merged work, including:

- Patient authentication and self-service portal
- Email OTP flows
- Optional Google Sign-In
- Pregnancy/obstetric appointment support
- Receptionist vitals
- Reception queue reordering
- Public Live OPD queue
- Appointment rescheduling
- Doctor complementary/discount request workflow
- Responsive/mobile/PWA improvements
- Public hospital website
- Healthcare image gallery using free-use Pexels photography
- Security/performance/runtime fixes

Before deploying, always pull the latest `main` and run the database migrations.

---

## License / third-party assets

Application source code belongs to this project unless otherwise stated.

The landing page photography uses images from **Pexels** under the Pexels License. These are free-use stock photographs; Pexels is not an open-source software license.

For the current image sources and licensing terms, see:

- https://www.pexels.com/license/

Always review third-party licenses before redistributing or replacing assets.

---

## Project status

This repository is an actively developed **OPD-focused HMS foundation**. Before real clinical production use, perform organization-specific validation for workflows, legal/privacy requirements, data retention, access controls, backups, clinical processes, and local regulatory requirements.


## Demo data (development / staging)

Run the normal seed command to create sample doctors, patients, schedules, and a live OPD queue:

```bash
npm run seed
```

The seed is idempotent and uses records prefixed with `DEMO-`. It creates three demo doctor accounts and six demo patients.

**Demo doctor password:** `Demo@12345`

Demo doctor emails:
- `demo.doctor1@chhayabithi.com`
- `demo.doctor2@chhayabithi.com`
- `demo.doctor3@chhayabithi.com`

These credentials are for development/staging only. Do not use them in production.

