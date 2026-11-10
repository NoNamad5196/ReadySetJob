const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/readysetjob.db');

function openDatabase(customPath) {
  const resolvedPath = customPath || process.env.DB_PATH || DEFAULT_DB_PATH;
  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = {
  openDatabase,
  DEFAULT_DB_PATH,
};
