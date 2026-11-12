const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./connection');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function hasTable(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function hasColumn(db, tableName, columnName) {
  if (!hasTable(db, tableName)) return false;
  const columns = db.pragma(`table_info(${tableName})`);
  return columns.some((col) => col.name === columnName);
}

function ensureColumn(db, tableName, columnName, columnDefSql) {
  if (hasTable(db, tableName) && !hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefSql}`);
  }
}

function migrate(db) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.pragma('foreign_keys = ON');
  db.exec(sql);

  ensureColumn(db, 'users', 'season_label', 'TEXT NULL');
  ensureColumn(db, 'applications', 'is_favorite', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'auto_feedback', 'INTEGER NOT NULL DEFAULT 0 CHECK (auto_feedback IN (0, 1))');
  db.exec('CREATE INDEX IF NOT EXISTS idx_todos_user_done_due ON todos(user_id, is_done, due_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_essay_feedback_lookup ON essay_feedback(user_id, essay_id, question_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_material_star_drafts_lookup ON material_star_drafts(user_id, material_id, id)');

  return db;
}

if (require.main === module) {
  require('dotenv').config();
  const db = openDatabase();
  migrate(db);
  db.close();
  console.log('Database migration completed.');
}

module.exports = { migrate, hasTable, hasColumn, ensureColumn };
