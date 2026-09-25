# API.md

The frontend is server-rendered EJS, not a SPA — most endpoints below return rendered HTML pages, not JSON. A few are JSON endpoints used by client-side JS for cascading dropdowns and live search. All routes require an authenticated session (`requireAuth`) unless noted, and every state-changing `POST` requires a valid CSRF token (the `_csrf` hidden field already present in every form).

## Auth
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/auth/login` | Rate-limited |
| POST | `/auth/logout` | |
| GET/POST | `/auth/reset-password` | Forced on `must_reset_password` accounts |

## Patients
| Method | Path | Permission |
|---|---|---|
| GET | `/patients/search` | `patient.view` or `patient.create` |
| GET | `/patients/search/results?q=` | JSON when `Accept: application/json` |
| GET/POST | `/patients/new` | `patient.create` |
| GET | `/patients` | `patient.view` (paginated) |
| GET | `/patients/:healthId` | `patient.view` |
| GET | `/patients/:healthId/slip` | Registration slip print view |
| GET | `/patients/:healthId/barcode` | PNG, authenticated only — never public |

## Doctors
| Method | Path | Permission |
|---|---|---|
| GET | `/doctors` | `doctor.manage` |
| GET/POST | `/doctors/new` | `doctor.manage` |
| GET/POST | `/doctors/:id` | `doctor.manage` |
| POST | `/doctors/:id/schedule` | `doctor.schedule.manage` or `doctor.manage` |
| GET | `/doctors/api/list?departmentId=&branchId=` | JSON, used by the booking cascade |
| GET | `/doctors/:id/slots?date=` | JSON, live slot availability |

## OPD
| Method | Path | Permission |
|---|---|---|
| GET/POST | `/opd/appointments/new` | `appointment.create` |
| GET | `/opd/appointments` | filters: `date`, `doctorId`, `status` |
| GET | `/opd/appointments/:id` | |
| POST | `/opd/appointments/:id/reschedule` | `appointment.reschedule` |
| POST | `/opd/appointments/:id/cancel` | `appointment.cancel` |
| GET | `/opd/queue` | `queue.manage` |
| POST | `/opd/visits/:visitId/status` | body: `status` |

## Doctor Portal
| Method | Path | Permission |
|---|---|---|
| GET | `/doctor/` , `/doctor/queue` | `consultation.create` |
| POST | `/doctor/queue/call-next` | |
| GET/POST | `/doctor/consultation/:visitId` | doctor-scope enforced |
| POST | `/doctor/consultation/:visitId/complete` | finalizes the clinical record |

## Prescriptions
| Method | Path | Permission |
|---|---|---|
| POST | `/prescriptions` | `prescription.create` |
| GET | `/prescriptions/:id` , `/prescriptions/:id/print` | |
| POST | `/prescriptions/:id/amend` | `prescription.amend`, doctor-scope enforced |
| GET | `/prescriptions/scan?code=` | authenticated barcode resolution |

## Billing
| Method | Path | Permission |
|---|---|---|
| GET/POST | `/billing/invoices/new?visitId=` | `billing.create` |
| GET | `/billing/invoices` , `/billing/invoices/:id` | `billing.view` |
| POST | `/billing/invoices/:id/discount-request` | `discount.request` |
| GET | `/billing/discount-requests` | `discount.approve` |
| POST | `/billing/discount-requests/:id/decide` | `discount.approve`, self-approval blocked |
| POST | `/billing/invoices/:id/payment` | `payment.record` |
| GET | `/billing/invoices/:id/receipt/:paymentId` | print view |

## Admin
| Method | Path | Permission |
|---|---|---|
| GET/POST | `/admin/users` | `user.manage` |
| GET/POST | `/admin/branches` | `branch.manage` |
| GET/POST | `/admin/departments` | `department.manage` |
| GET | `/admin/audit-logs` | `audit.view` |

## Reports
| Method | Path | Permission |
|---|---|---|
| GET | `/reports`, `/reports/daily`, `/reports/doctor`, `/reports/billing` | `report.view` |

All filters are query parameters (`from`, `to`, `branchId`, `departmentId`, `doctorId`, `status`) and default sensibly (today's date, all branches) when omitted.
