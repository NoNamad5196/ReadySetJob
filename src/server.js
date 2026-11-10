require('dotenv').config();
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`ReadySetJob server listening on http://localhost:${port}`);
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
