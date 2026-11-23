const fs = require('node:fs');
const path = require('node:path');
const Database = require('libsql');

const { SqliteError } = Database;
const DEFAULT_DB_PATH = path.join(__dirname, '../../data/readysetjob.db');
const ALLOWED_PROTOCOLS = new Set(['libsql:', 'https:', 'http:', 'ws:', 'wss:']);
const TOKEN_PROTOCOLS = new Set(['libsql:', 'https:', 'wss:']);
const WRAPPED_SYMBOL = Symbol('readysetjob.libsqlWrapped');
let activeDb = null;

function stripMetadata(row) {
  if (row && typeof row === 'object' && !Array.isArray(row) && Object.prototype.hasOwnProperty.call(row, '_metadata')) {
    delete row._metadata;
  }
  return row;
}

function formatRow(row, pluckEnabled) {
  if (row === undefined || row === null) return row;
  const clean = stripMetadata(row);
  if (!pluckEnabled) return clean;
  if (Array.isArray(clean)) return clean[0];
  const keys = Object.keys(clean);
  return keys.length > 0 ? clean[keys[0]] : undefined;
}

const normalizeBind = (args) => (args.length === 1 && args[0] === null ? [[null]] : args);

function wrapStatement(rawStmt) {
  let pluckEnabled = false;
  let rawEnabled = false;

  const stmt = {
    get reader() { return rawStmt.reader; },
    pluck(toggle) {
      pluckEnabled = toggle === undefined ? true : Boolean(toggle);
      if (pluckEnabled && rawEnabled) { rawEnabled = false; rawStmt.raw(false); }
      rawStmt.pluck(pluckEnabled);
      return stmt;
    },
    raw(toggle) {
      rawEnabled = toggle === undefined ? true : Boolean(toggle);
      if (rawEnabled && pluckEnabled) { pluckEnabled = false; rawStmt.pluck(false); }
      rawStmt.raw(rawEnabled);
      return stmt;
    },
    timing(toggle) { if (typeof rawStmt.timing === 'function') rawStmt.timing(toggle); return stmt; },
    safeIntegers(toggle) { rawStmt.safeIntegers(toggle); return stmt; },
    run(...args) { return rawStmt.run(...normalizeBind(args)); },
    get(...args) { return formatRow(rawStmt.get(...normalizeBind(args)), pluckEnabled); },
    iterate(...args) {
      const inner = rawStmt.iterate(...normalizeBind(args));
      const iter = {
        next() {
          const step = inner.next();
          return step.done ? step : { value: formatRow(step.value, pluckEnabled), done: false };
        },
        return(value) { return typeof inner.return === 'function' ? inner.return(value) : { done: true, value }; },
        [Symbol.iterator]() { return iter; },
      };
      return iter;
    },
    all(...args) {
      if (typeof rawStmt.iterate === 'function') return Array.from(stmt.iterate(...args));
      return rawStmt.all(...normalizeBind(args)).map((row) => formatRow(row, pluckEnabled));
    },
    columns() { return rawStmt.columns(); },
    interrupt() { return rawStmt.interrupt(); },
  };
  return stmt;
}

function wrapDatabase(rawDb, meta = {}) {
  if (!rawDb || rawDb[WRAPPED_SYMBOL]) return rawDb;
  const mode = meta.mode || (meta.isReplica ? 'replica' : 'local');
  const isReplica = meta.isReplica !== undefined ? Boolean(meta.isReplica) : mode === 'replica';
  const dbPath = meta.dbPath || '';
  let savepointSeq = 0;
  let txDepth = 0;
  let isOpen = rawDb.open !== false;
  const execSafe = (sql) => { try { rawDb.exec(sql); } catch (_err) {} };

  const wrapper = {
    [WRAPPED_SYMBOL]: true,
    get open() { return isOpen && rawDb.open !== false; },
    get inTransaction() { return Boolean(rawDb.inTransaction || txDepth > 0); },
    get memory() { return Boolean(rawDb.memory); },
    get readonly() { return Boolean(rawDb.readonly); },
    get name() { return rawDb.name || dbPath; },
    get mode() { return mode; },
    get isReplica() { return isReplica; },
    prepare(sql) { return wrapStatement(rawDb.prepare(sql)); },
    exec(sql) { rawDb.exec(sql); return wrapper; },
    pragma(source, options = {}) {
      if (typeof source !== 'string') throw new TypeError('Expected first argument to be a string');
      const opts = options == null ? {} : options;
      if (typeof opts !== 'object') throw new TypeError('Expected second argument to be an options object');
      const stmt = wrapper.prepare(`PRAGMA ${source}`);
      return opts.simple ? stmt.pluck(true).get() : stmt.all();
    },
    transaction(fn) {
      if (typeof fn !== 'function') throw new TypeError('Expected first argument to be a function');
      const runScope = (beginSql, commitSql, rollbackFn, ctx, args) => {
        rawDb.exec(beginSql);
        txDepth += 1;
        try {
          const result = fn.apply(ctx, args);
          rawDb.exec(commitSql);
          return result;
        } catch (err) {
          if (rawDb.inTransaction || txDepth > 0) rollbackFn();
          throw err;
        } finally { txDepth = Math.max(0, txDepth - 1); }
      };
      const buildRunner = (beginMode) => function txRunner(...args) {
        if (txDepth === 0 && !rawDb.inTransaction) {
          return runScope(beginMode ? `BEGIN ${beginMode}` : 'BEGIN', 'COMMIT', () => execSafe('ROLLBACK'), this, args);
        }
        const sp = `_rsj_sp_${++savepointSeq}`;
        return runScope(`SAVEPOINT ${sp}`, `RELEASE SAVEPOINT ${sp}`, () => {
          execSafe(`ROLLBACK TO SAVEPOINT ${sp}`);
          execSafe(`RELEASE SAVEPOINT ${sp}`);
        }, this, args);
      };
      const props = {
        default: { value: buildRunner('') },
        deferred: { value: buildRunner('DEFERRED') },
        immediate: { value: buildRunner('IMMEDIATE') },
        exclusive: { value: buildRunner('EXCLUSIVE') },
        database: { value: wrapper, enumerable: true },
      };
      for (const k of ['default', 'deferred', 'immediate', 'exclusive']) Object.defineProperties(props[k].value, props);
      return props.default.value;
    },
    sync() {
      return !isReplica || typeof rawDb.sync !== 'function' ? { frames_synced: 0, replication_index: 0 } : rawDb.sync();
    },
    defaultSafeIntegers(toggle) { rawDb.defaultSafeIntegers(toggle); return wrapper; },
    interrupt() { return rawDb.interrupt(); },
    authorizer(rules) { return rawDb.authorizer(rules); },
    batch(...args) {
      if (typeof rawDb.batch !== 'function') throw new Error('batch is not supported by this libsql driver');
      return rawDb.batch(...args);
    },
    maxWriteReplicationIndex() {
      return typeof rawDb.maxWriteReplicationIndex === 'function' ? rawDb.maxWriteReplicationIndex() : undefined;
    },
    close() {
      if (!isOpen) { if (activeDb === wrapper) activeDb = null; return; }
      try {
        if (isReplica && typeof rawDb.sync === 'function') {
          try {
            rawDb.sync();
          } catch (syncErr) {
            if (process.env.NODE_ENV !== 'test') {
              console.warn('[ReadySetJob] Warning: Replica sync on close failed:', syncErr && syncErr.message ? syncErr.message : String(syncErr));
            }
          }
        }
        if (rawDb.open !== false && typeof rawDb.close === 'function') rawDb.close();
      } finally {
        isOpen = false;
        if (activeDb === wrapper) activeDb = null;
      }
    },
  };
  return wrapper;
}

function parseSyncPeriod(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  if (typeof raw === 'boolean') throw new Error('TURSO_SYNC_PERIOD must be a non-negative number.');
  const num = Number(String(raw).trim());
  if (!Number.isFinite(num) || num < 0) throw new Error('TURSO_SYNC_PERIOD must be a non-negative number.');
  return num;
}

function resolveConnectionConfig(customPath, options = {}, env = process.env) {
  const opts = options || {};
  const safeEnv = opts.env || env || {};
  const dbPath = customPath || safeEnv.DB_PATH || DEFAULT_DB_PATH;
  const isMemory = dbPath === ':memory:';
  const localCfg = { mode: 'local', isReplica: false, dbPath, syncUrl: null, authToken: null, syncPeriod: 0 };

  const explicitSyncUrl = typeof opts.syncUrl === 'string' ? opts.syncUrl.trim() : '';
  if (isMemory && explicitSyncUrl) throw new Error('Cannot use Turso syncUrl with :memory: database.');
  if (isMemory || opts.localOnly) return localCfg;

  const allowEnv = safeEnv.NODE_ENV !== 'test' || Boolean(opts.allowEnvInTest);
  const syncUrl = explicitSyncUrl || (allowEnv ? String(safeEnv.TURSO_DATABASE_URL || '').trim() : '');
  const authToken = opts.authToken !== undefined
    ? String(opts.authToken || '').trim()
    : (allowEnv ? String(safeEnv.TURSO_AUTH_TOKEN || '').trim() : '');

  if (!syncUrl && !authToken) return localCfg;
  if (!syncUrl && authToken) throw new Error('TURSO_DATABASE_URL is required when TURSO_AUTH_TOKEN is set.');

  let parsedUrl;
  try { parsedUrl = new URL(syncUrl); } catch (_e) { throw new Error('Invalid TURSO_DATABASE_URL format.'); }
  if (!ALLOWED_PROTOCOLS.has(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error(`Unsupported TURSO_DATABASE_URL protocol "${parsedUrl.protocol}".`);
  }
  if (TOKEN_PROTOCOLS.has(parsedUrl.protocol) && !authToken) {
    throw new Error(`TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL uses ${parsedUrl.protocol}.`);
  }

  const rawPeriod = opts.syncPeriod !== undefined ? opts.syncPeriod : (allowEnv ? safeEnv.TURSO_SYNC_PERIOD : undefined);
  return { mode: 'replica', isReplica: true, dbPath, syncUrl, authToken, syncPeriod: parseSyncPeriod(rawPeriod), readYourWrites: true };
}

function openDatabase(customPath, options = {}) {
  const opts = options || {};
  const config = resolveConnectionConfig(customPath, opts, opts.env || process.env);
  if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const DatabaseCtor = opts.DatabaseClass || opts.DatabaseCtor || Database;
  const dbOpts = config.isReplica
    ? { syncUrl: config.syncUrl, authToken: config.authToken, readYourWrites: true }
    : { timeout: 5000 };
  if (config.isReplica && config.syncPeriod > 0) dbOpts.syncPeriod = config.syncPeriod;

  const rawDb = new DatabaseCtor(config.dbPath, dbOpts);
  try {
    if (config.isReplica) {
      if (typeof rawDb.sync === 'function') rawDb.sync();
    } else if (config.dbPath !== ':memory:') {
      rawDb.pragma('journal_mode = WAL');
    }
    rawDb.pragma('foreign_keys = ON');
  } catch (err) {
    try { if (rawDb && rawDb.open !== false && typeof rawDb.close === 'function') rawDb.close(); } catch (_e) {}
    throw err;
  }

  const db = wrapDatabase(rawDb, config);
  if (opts.setActive !== false) activeDb = db;
  return db;
}

const getActiveDatabase = () => activeDb;

module.exports = {
  openDatabase,
  getActiveDatabase,
  resolveConnectionConfig,
  resolveDatabaseConfig: resolveConnectionConfig,
  wrapDatabase,
  DEFAULT_DB_PATH,
  SqliteError,
};
