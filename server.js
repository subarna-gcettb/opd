const app = require('./app');
const appConfig = require('./config/appConfig');
const { pool } = require('./config/database');

async function start() {
  if (appConfig.isProd) {
    const required = ['SESSION_SECRET', 'CSRF_SECRET', 'AADHAAR_ENCRYPTION_KEY', 'AADHAAR_HASH_SECRET'];
    const missing = required.filter((name) => !process.env[name] || process.env[name].length < 32);
    if (missing.length) {
      console.error('[CONFIG] Missing/weak production secrets:', missing.join(', '));
      process.exit(1);
    }
  }

  try {
    // Fail fast if the database isn't reachable.
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('[DB] Connection verified.');
  } catch (err) {
    console.error('[DB] Could not connect to MySQL. Check your .env settings.', err.message);
    process.exit(1);
  }

  const server = app.listen(appConfig.port, () => {
    console.log(`[HMS] ${appConfig.appName}`);
    console.log(`[HMS] Listening on port ${appConfig.port} (${appConfig.env})`);
  });

  const shutdown = (signal) => {
    console.log(`\n[HMS] Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
