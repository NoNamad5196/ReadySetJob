require('dotenv').config();
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const app = createApp();

if (process.env.AUTO_SEED === '1') {
  try {
    const demoUser = app.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get('demo@readysetjob.dev');

    if (!demoUser) {
      console.log('[ReadySetJob] Demo account not found. Seeding demo data...');
      const { seed } = require('./db/seed');
      seed(app.db);
      console.log('[ReadySetJob] AUTO_SEED: demo data inserted.');
    }
  } catch (err) {
    console.error('[ReadySetJob] AUTO_SEED failed:', err && err.message ? err.message : String(err));
  }
}

const server = app.listen(port, () => {
  const dbMode = app.db && app.db.mode ? app.db.mode : 'local';
  console.log(`ReadySetJob server listening on http://localhost:${port} (db: ${dbMode})`);
});

function shutdown() {
  server.close(() => {
    if (app.db && app.db.open) {
      app.db.close();
    }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
