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

    console.log('[seed] Done.');
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
