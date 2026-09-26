require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

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
    // IMPORTANT: this command intentionally performs a destructive full reset.
    // It drops every table in the configured database and rebuilds the schema
    // from the current migration files. Do not use it against live production
    // data unless a complete reset is explicitly intended.
    console.warn('[migrate] WARNING: resetting the entire database...');
    console.warn('[migrate] All existing tables and data in DB_NAME will be deleted.');

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    const [tables] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?`,
      [process.env.DB_NAME]
    );

    for (const table of tables) {
      const tableName = String(table.TABLE_NAME).replace(/`/g, '``');
      await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(150) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    const applied = new Set();

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ranAny = false;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] Skipping ${file} (already applied)`);
        continue;
      }
      console.log(`[migrate] Applying ${file} ...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`[migrate] Applied ${file}`);
      ranAny = true;
    }

    // indexes.sql is applied once, tracked the same way as a migration.
    const indexesFile = 'indexes.sql';
    if (!applied.has(indexesFile) && fs.existsSync(path.join(__dirname, indexesFile))) {
      console.log('[migrate] Applying indexes.sql ...');
      const sql = fs.readFileSync(path.join(__dirname, indexesFile), 'utf8');
      try {
        await connection.query(sql);
      } catch (err) {
        // Composite indexes may already exist on a re-run; don't fail the whole migration for that.
        if (err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_TABLE_EXISTS_ERROR') throw err;
        console.warn('[migrate] Some indexes/tables in indexes.sql already existed — continuing.');
      }
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [indexesFile]);
      ranAny = true;
    }

    console.log(ranAny ? '[migrate] Done.' : '[migrate] Nothing to do — database is up to date.');
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
