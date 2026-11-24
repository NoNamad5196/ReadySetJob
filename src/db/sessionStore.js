const session = require('express-session');

const DEFAULT_INTERVAL_MS = 900000; // 15 minutes
const ONE_DAY_MS = 86400000;

class LibsqlSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);

    if (!options.client) {
      throw new Error('A client must be directly provided to LibsqlSessionStore');
    }

    this.client = options.client;
    this.tableName = options.tableName || 'sessions';
    this.intervalMs = (options.expired && options.expired.intervalMs) || DEFAULT_INTERVAL_MS;

    this.createTable();

    if (!options.expired || options.expired.clear !== false) {
      this.startInterval();
    }
  }

  createTable() {
    this.client.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        sid TEXT NOT NULL PRIMARY KEY,
        sess TEXT NOT NULL,
        expire TEXT NOT NULL
      )
    `);
  }

  startInterval() {
    const timer = setInterval(() => {
      this.clearExpiredSessions();
    }, this.intervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  clearExpiredSessions() {
    if (!this.client || this.client.open === false) {
      return;
    }
    try {
      this.client
        .prepare(`DELETE FROM ${this.tableName} WHERE datetime('now') > datetime(expire)`)
        .run();
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[ReadySetJob] Failed to clear expired sessions:', err.message);
      }
    }
  }

  get(sid, cb = () => {}) {
    try {
      const row = this.client
        .prepare(`SELECT sess FROM ${this.tableName} WHERE sid = ? AND datetime('now') < datetime(expire)`)
        .get(sid);

      if (!row || !row.sess) {
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.sess));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      const maxAge = sess && sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : ONE_DAY_MS;
      const expire = new Date(Date.now() + maxAge).toISOString();
      const sessStr = JSON.stringify(sess);

      this.client
        .prepare(`INSERT OR REPLACE INTO ${this.tableName} (sid, sess, expire) VALUES (?, ?, ?)`)
        .run(sid, sessStr, expire);

      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      let expire;
      if (sess && sess.cookie && sess.cookie.expires) {
        expire = new Date(sess.cookie.expires).toISOString();
      } else {
        const maxAge = sess && sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : ONE_DAY_MS;
        expire = new Date(Date.now() + maxAge).toISOString();
      }

      this.client
        .prepare(`UPDATE ${this.tableName} SET expire = ? WHERE sid = ? AND datetime('now') < datetime(expire)`)
        .run(expire, sid);

      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.client
        .prepare(`DELETE FROM ${this.tableName} WHERE sid = ?`)
        .run(sid);

      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  all(cb = () => {}) {
    try {
      const rows = this.client
        .prepare(`SELECT * FROM ${this.tableName}`)
        .all();

      return cb(null, rows);
    } catch (err) {
      return cb(err);
    }
  }

  length(cb = () => {}) {
    try {
      const row = this.client
        .prepare(`SELECT COUNT(*) AS count FROM ${this.tableName}`)
        .get();

      return cb(null, row ? Number(row.count) || 0 : 0);
    } catch (err) {
      return cb(err);
    }
  }

  clear(cb = () => {}) {
    try {
      this.client
        .prepare(`DELETE FROM ${this.tableName}`)
        .run();

      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }
}

module.exports = {
  LibsqlSessionStore,
};
