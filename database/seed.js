require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  try {
    console.log('[seed] Applying seed.sql (branches, departments, roles, permissions, medicines) ...');
    const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await connection.query(sql);

    const email = (process.env.SEED_SUPERADMIN_EMAIL || 'admin@chhayabithi.com').toLowerCase();
    const password = process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe@123';
    const mustReset = process.env.SEED_SUPERADMIN_MUST_RESET !== 'false';

    const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      console.log(`[seed] Super Admin (${email}) already exists — skipping user creation.`);
    } else {
      const [branchRows] = await connection.query('SELECT id FROM branches LIMIT 1');
      const branchId = branchRows.length ? branchRows[0].id : null;

      const passwordHash = await bcrypt.hash(password, 12);
      const [result] = await connection.query(
        `INSERT INTO users (branch_id, name, email, password_hash, must_reset_password, is_active)
         VALUES (?, 'Super Admin', ?, ?, ?, 1)`,
        [branchId, email, passwordHash, mustReset ? 1 : 0]
      );
      const userId = result.insertId;

      const [[role]] = await connection.query("SELECT id FROM roles WHERE code = 'SUPER_ADMIN'");
      await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id]);

      console.log(`[seed] Created Super Admin: ${email} / ${password}`);
      console.log('[seed] IMPORTANT: change this password immediately after first login (this is enforced automatically).');
    }


    // ---------------------------------------------------------------
    // Demo data for development / staging. Idempotent and isolated by
    // DEMO-* codes/emails so production records are never overwritten.
    // ---------------------------------------------------------------
    console.log('[seed] Ensuring demo doctors and patients ...');

    const demoPasswordHash = await bcrypt.hash('Demo@12345', 12);
    const [[demoBranch]] = await connection.query(
      "SELECT id FROM branches WHERE code = '01' LIMIT 1"
    );
    const branchId = demoBranch.id;

    const demoDoctors = [
      { code: 'DEMO-DOC-01', name: 'Dr. Ananya Sen', email: 'demo.doctor1@chhayabithi.com', mobile: '9000000001', gender: 'Female', qualification: 'MBBS, MD (Medicine)', specialisation: 'General Medicine', dept: 'General Medicine', experience: 8, fee: 600 },
      { code: 'DEMO-DOC-02', name: 'Dr. Arindam Roy', email: 'demo.doctor2@chhayabithi.com', mobile: '9000000002', gender: 'Male', qualification: 'MBBS, MS (Orthopedics)', specialisation: 'Orthopedics', dept: 'Orthopedics', experience: 11, fee: 700 },
      { code: 'DEMO-DOC-03', name: 'Dr. Priyanka Das', email: 'demo.doctor3@chhayabithi.com', mobile: '9000000003', gender: 'Female', qualification: 'MBBS, MD (Gynae)', specialisation: 'Gynecology', dept: 'Gynecology', experience: 7, fee: 650 }
    ];

    const doctorIds = {};
    for (const doc of demoDoctors) {
      const [existingUser] = await connection.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [doc.email]
      );
      let userId;
      if (existingUser.length) {
        userId = existingUser[0].id;
      } else {
        const [userResult] = await connection.query(
          `INSERT INTO users
            (branch_id, name, email, mobile, password_hash, must_reset_password, is_active)
           VALUES (?, ?, ?, ?, ?, 0, 1)`,
          [branchId, doc.name, doc.email, doc.mobile, demoPasswordHash]
        );
        userId = userResult.insertId;
      }

      const [[role]] = await connection.query("SELECT id FROM roles WHERE code = 'DOCTOR'");
      await connection.query(
        'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, role.id]
      );

      const [[department]] = await connection.query(
        'SELECT id FROM departments WHERE name = ? LIMIT 1',
        [doc.dept]
      );

      const [existingDoctor] = await connection.query(
        'SELECT id FROM doctors WHERE doctor_code = ? LIMIT 1',
        [doc.code]
      );

      let doctorId;
      if (existingDoctor.length) {
        doctorId = existingDoctor[0].id;
      } else {
        const [doctorResult] = await connection.query(
          `INSERT INTO doctors
            (user_id, doctor_code, gender, mobile, email, qualification, specialisation,
             department_id, branch_id, experience_years, consultation_fee, joining_date, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 1)`,
          [
            userId, doc.code, doc.gender, doc.mobile, doc.email, doc.qualification,
            doc.specialisation, department.id, branchId, doc.experience, doc.fee
          ]
        );
        doctorId = doctorResult.insertId;
      }

      doctorIds[doc.code] = { id: doctorId, departmentId: department.id };

      for (let weekday = 1; weekday <= 6; weekday += 1) {
        await connection.query(
          `INSERT INTO doctor_schedule_templates
             (doctor_id, weekday, start_time, end_time, slot_duration_minutes, max_patients_per_slot, is_active)
           SELECT ?, ?, ?, ?, 15, 1, 1
           WHERE NOT EXISTS (
             SELECT 1 FROM doctor_schedule_templates
             WHERE doctor_id = ? AND weekday = ?
           )`,
          [doctorId, weekday, weekday === 3 ? '16:00:00' : '10:00:00',
           weekday === 3 ? '19:00:00' : '13:00:00', doctorId, weekday]
        );
      }
    }

    const [[adminUser]] = await connection.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1', [email]
    );

    const demoPatients = [
      { health: '26010000001', reg: 'DEMO-2026-001', name: 'Riya Mukherjee', father: 'Sanjay Mukherjee', gender: 'Female', age: 29, mobile: '9100000001', village: 'Gorabazar', district: 'Murshidabad', conditions: 'Seasonal allergy' },
      { health: '26010000002', reg: 'DEMO-2026-002', name: 'Arjun Ghosh', father: 'Bimal Ghosh', gender: 'Male', age: 42, mobile: '9100000002', village: 'Khagra', district: 'Murshidabad', conditions: 'Hypertension' },
      { health: '26010000003', reg: 'DEMO-2026-003', name: 'Moumita Saha', father: 'Subhash Saha', gender: 'Female', age: 34, mobile: '9100000003', village: 'Berhampore', district: 'Murshidabad', conditions: 'None reported' },
      { health: '26010000004', reg: 'DEMO-2026-004', name: 'Sourav Mondal', father: 'Pradip Mondal', gender: 'Male', age: 25, mobile: '9100000004', village: 'Cossimbazar', district: 'Murshidabad', conditions: 'None reported' },
      { health: '26010000005', reg: 'DEMO-2026-005', name: 'Nandini Paul', father: 'Ashok Paul', gender: 'Female', age: 31, mobile: '9100000005', village: 'Lalbagh', district: 'Murshidabad', conditions: 'Migraine' },
      { health: '26010000006', reg: 'DEMO-2026-006', name: 'Rahul Chatterjee', father: 'Amit Chatterjee', gender: 'Male', age: 55, mobile: '9100000006', village: 'Jangipur', district: 'Murshidabad', conditions: 'Diabetes' }
    ];

    const patientIds = {};
    for (const patient of demoPatients) {
      const [existing] = await connection.query(
        'SELECT id FROM patients WHERE health_id = ? LIMIT 1',
        [patient.health]
      );
      let patientId;
      if (existing.length) {
        patientId = existing[0].id;
      } else {
        const [result] = await connection.query(
          `INSERT INTO patients
            (health_id, registration_number, branch_id, name, father_name, gender, age_years, mobile, created_by, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
          [
            patient.health, patient.reg, branchId, patient.name, patient.father,
            patient.gender, patient.age, patient.mobile, adminUser.id
          ]
        );
        patientId = result.insertId;
      }

      await connection.query(
        `INSERT INTO patient_addresses
          (patient_id, address, village_town, police_station, district, state, pin_code)
         SELECT ?, 'Demo residential address', ?, 'Berhampore', ?, 'West Bengal', '742101'
         WHERE NOT EXISTS (SELECT 1 FROM patient_addresses WHERE patient_id = ?)`,
        [patientId, patient.village, patient.district, patientId]
      );

      await connection.query(
        `INSERT INTO patient_medical_profiles
          (patient_id, blood_group, allergies, existing_conditions)
         SELECT ?, 'O+', NULL, ?
         WHERE NOT EXISTS (SELECT 1 FROM patient_medical_profiles WHERE patient_id = ?)`,
        [patientId, patient.conditions, patientId]
      );

      patientIds[patient.health] = patientId;
    }

    // Demo environment intentionally contains doctors and patients only.
    // Remove any legacy DEMO appointment/visit data from earlier seed versions.
    const [legacyVisits] = await connection.query(
      `SELECT v.id FROM opd_visits v
       JOIN appointments a ON a.id = v.appointment_id
       WHERE a.appointment_code LIKE 'DEMO-%'`
    );
    const legacyVisitIds = legacyVisits.map((v) => v.id);
    if (legacyVisitIds.length) {
      const placeholders = legacyVisitIds.map(() => '?').join(',');
      await connection.query(`DELETE FROM prescription_attachments WHERE visit_id IN (${placeholders})`, legacyVisitIds);
      await connection.query(`DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${placeholders}))`, legacyVisitIds);
      await connection.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${placeholders}))`, legacyVisitIds);
      await connection.query(`DELETE FROM discount_requests WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${placeholders}))`, legacyVisitIds);
      await connection.query(`DELETE FROM invoices WHERE visit_id IN (${placeholders})`, legacyVisitIds);
      await connection.query(`DELETE FROM appointment_vitals WHERE visit_id IN (${placeholders})`, legacyVisitIds);
      await connection.query(`DELETE FROM opd_consultations WHERE visit_id IN (${placeholders})`, legacyVisitIds);
      await connection.query(`DELETE FROM opd_visits WHERE id IN (${placeholders})`, legacyVisitIds);
    }
    await connection.query(`DELETE a FROM appointments a WHERE a.appointment_code LIKE 'DEMO-%'`);

    console.log('[seed] Demo doctors and patients ready. No demo appointments or queue records are created. Demo doctor password: Demo@12345');

    console.log('[seed] Done.');
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
