require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const INDEXES_FILE = path.join(__dirname, 'indexes.sql');
const BASELINE_REQUIRED_TABLE = 'users';

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
    [process.env.DB_NAME, tableName]
  );
  return rows.length > 0;
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(150) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}

async function run() {
  if (!process.env.DB_NAME || !process.env.DB_USER) {
    throw new Error('DB_NAME and DB_USER are required before running migrations.');
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  try {
    // Migrations are deliberately NON-DESTRUCTIVE. Never drop application
    // tables here: this command is also used during production deployments.
    await ensureMigrationTable(connection);

    const [appliedRows] = await connection.query(
      'SELECT filename FROM schema_migrations ORDER BY id'
    );
    const applied = new Set(appliedRows.map((row) => row.filename));

    const existingCoreSchema = await tableExists(connection, BASELINE_REQUIRED_TABLE);
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (existingCoreSchema && applied.size === 0 && files.length > 1) {
      throw new Error(
        'Existing database detected without migration history. Refusing to guess the schema version. ' +
        'Create a verified schema baseline in schema_migrations first, then rerun npm run migrate. ' +
        'No tables or data were changed.'
      );
    }

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`[migrate] Applying ${file} ...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await connection.beginTransaction();
      try {
        await connection.query(sql);
        await connection.query(
          'INSERT INTO schema_migrations (filename) VALUES (?)',
          [file]
        );
        await connection.commit();
      } catch (err) {
        try { await connection.rollback(); } catch (_) {}
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
      console.log(`[migrate] Applied ${file}`);
    }

    if (fs.existsSync(INDEXES_FILE) && !applied.has('indexes.sql')) {
      console.log('[migrate] Applying indexes.sql ...');
      const sql = fs.readFileSync(INDEXES_FILE, 'utf8');
      await connection.beginTransaction();
      try {
        await connection.query(sql);
        await connection.query(
          'INSERT INTO schema_migrations (filename) VALUES (?)',
          ['indexes.sql']
        );
        await connection.commit();
      } catch (err) {
        try { await connection.rollback(); } catch (_) {}
        // Existing indexes are expected on some manually provisioned databases.
        if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_TABLE_EXISTS_ERROR') {
          await connection.rollback().catch(() => {});
          await connection.query(
            'INSERT IGNORE INTO schema_migrations (filename) VALUES (?)',
            ['indexes.sql']
          );
          console.warn('[migrate] Existing index/table detected; indexes.sql marked applied.');
        } else {
          throw new Error(`Migration indexes.sql failed: ${err.message}`, { cause: err });
        }
      }
      console.log('[migrate] Applied indexes.sql');
    }

    console.log('[migrate] Done. No destructive database reset is performed by this command.');
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
