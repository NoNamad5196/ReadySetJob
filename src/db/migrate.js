const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./connection');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function migrate(db) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.pragma('foreign_keys = ON');
  db.exec(sql);
  return db;
}

if (require.main === module) {
  require('dotenv').config();
  const db = openDatabase();
  migrate(db);
  db.close();
  console.log('Database migration completed.');
}

module.exports = { migrate };
