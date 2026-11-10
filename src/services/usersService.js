const bcrypt = require('bcryptjs');

function findByEmail(db, email) {
  const normalized = String(email || '').trim().toLowerCase();
  return db
    .prepare('SELECT id, email, password_hash, name, created_at FROM users WHERE lower(email) = ?')
    .get(normalized);
}

function findById(db, id) {
  return db
    .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
    .get(Number(id));
}

function createUser(db, { email, password, name }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const trimmedName = String(name).trim();
  const passwordHash = bcrypt.hashSync(password, 10);

  const info = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(normalizedEmail, passwordHash, trimmedName);

  return findById(db, info.lastInsertRowid);
}

function verifyUserCredentials(db, { email, password }) {
  const user = findByEmail(db, email);
  if (!user) {
    return null;
  }
  const ok = bcrypt.compareSync(String(password || ''), user.password_hash);
  if (!ok) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function getDashboardCounts(db, userId) {
  const companiesCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM companies WHERE user_id = ?')
    .get(userId).cnt;
  const jobsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM job_posts WHERE user_id = ?')
    .get(userId).cnt;
  const bookmarkedJobsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM job_posts WHERE user_id = ? AND is_bookmarked = 1')
    .get(userId).cnt;
  const applicationsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM applications WHERE user_id = ?')
    .get(userId).cnt;
  const inProgressCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM applications WHERE user_id = ? AND result = 'in_progress'")
    .get(userId).cnt;
  const passedCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM applications WHERE user_id = ? AND result = 'passed'")
    .get(userId).cnt;
  const upcomingEventsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM events WHERE user_id = ?')
    .get(userId).cnt;

  return {
    companiesCount,
    jobsCount,
    bookmarkedJobsCount,
    applicationsCount,
    inProgressCount,
    passedCount,
    upcomingEventsCount,
  };
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  verifyUserCredentials,
  getDashboardCounts,
};
