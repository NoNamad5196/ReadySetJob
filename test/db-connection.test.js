const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  openDatabase,
  resolveConnectionConfig,
  resolveDatabaseConfig,
  wrapDatabase,
  getActiveDatabase,
  DEFAULT_DB_PATH,
  SqliteError,
} = require('../src/db/connection');

function makeMockDatabaseClass({ failOnSync = false, failSyncOnClose = false } = {}) {
  const instances = [];

  class MockDatabase {
    constructor(dbPath, opts) {
      this.dbPath = dbPath;
      this.opts = opts;
      this.open = true;
      this.inTransaction = false;
      this.memory = dbPath === ':memory:';
      this.readonly = false;
      this.name = dbPath;
      this.pragmas = [];
      this.syncCount = 0;
      this.closeCount = 0;
      this.failOnSync = failOnSync;
      this.failSyncOnClose = failSyncOnClose;
      instances.push(this);
    }

    sync() {
      this.syncCount += 1;
      if (this.failOnSync && this.syncCount === 1) {
        throw new Error('simulated startup sync error');
      }
      if (this.failSyncOnClose && this.syncCount > 1) {
        throw new Error('simulated shutdown sync error');
      }
      return { frames_synced: 3, replication_index: 7 };
    }

    pragma(sql) {
      this.pragmas.push(sql);
      return [];
    }

    prepare() {
      return {
        reader: true,
        pluck() { return this; },
        raw() { return this; },
        safeIntegers() { return this; },
        run() { return { changes: 0, lastInsertRowid: 0 }; },
        get() { return undefined; },
        iterate() { return [][Symbol.iterator](); },
        all() { return []; },
        columns() { return []; },
        interrupt() {},
      };
    }

    exec() {}
    defaultSafeIntegers() { return this; }
    interrupt() {}

    close() {
      this.closeCount += 1;
      this.open = false;
    }
  }

  MockDatabase.instances = instances;
  return MockDatabase;
}

describe('DB Connection Wrapper (libsql compatibility & dual mode)', () => {
  it('defaults to local mode, handles null bind parameters, and sets WAL on file DB', () => {
    assert.equal(resolveDatabaseConfig, resolveConnectionConfig);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsj-local-file-'));
    const filePath = path.join(tmpDir, 'nested', 'app.db');
    try {
      const fileDb = openDatabase(filePath);
      assert.equal(fileDb.open, true);
      assert.equal(fileDb.mode, 'local');
      assert.equal(fileDb.isReplica, false);
      assert.equal(fileDb.pragma('journal_mode', { simple: true }), 'wal');
      assert.equal(fileDb.pragma('foreign_keys', { simple: true }), 1);
      fileDb.close();
      assert.equal(fileDb.open, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const db = openDatabase(':memory:', { setActive: false });
    assert.equal(db.mode, 'local');
    assert.equal(db.isReplica, false);
    assert.equal(db.memory, true);
    assert.deepEqual(db.sync(), { frames_synced: 0, replication_index: 0 });
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT, score INTEGER)');
    const insertNull = db.prepare('INSERT INTO items (title, score) VALUES (?, 1)').run(null);
    assert.equal(insertNull.changes, 1);
    const nullRow = db.prepare('SELECT id, title FROM items WHERE title IS ?').get(null);
    assert.deepEqual(nullRow, { id: 1, title: null });
    assert.equal(Object.prototype.hasOwnProperty.call(nullRow, '_metadata'), false);

    db.close();
  });

  it('strips _metadata on get/all/iterate/pragma and honors pluck/raw/timing/safeIntegers chaining', () => {
    const db = openDatabase(':memory:', { setActive: false });
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT, score INTEGER)');
    db.prepare('INSERT INTO items (title, score) VALUES (?, ?)').run('Alpha', 10);
    db.prepare('INSERT INTO items (title, score) VALUES (?, ?)').run('Beta', 20);

    const row = db.prepare('SELECT id, title, score FROM items WHERE id = ?').get(1);
    assert.deepEqual(row, { id: 1, title: 'Alpha', score: 10 });
    assert.deepEqual(Object.keys(row), ['id', 'title', 'score']);
    assert.equal(JSON.stringify(row), '{"id":1,"title":"Alpha","score":10}');
    assert.equal('_metadata' in row, false);
    assert.equal(Object.prototype.hasOwnProperty.call(row, '_metadata'), false);

    assert.equal(db.prepare('SELECT id FROM items WHERE id = ?').get(999), undefined);

    const allRows = db.prepare('SELECT id, title FROM items ORDER BY id').all();
    assert.deepEqual(allRows, [
      { id: 1, title: 'Alpha' },
      { id: 2, title: 'Beta' },
    ]);
    for (const r of allRows) {
      assert.equal('_metadata' in r, false);
    }

    const iterRows = [...db.prepare('SELECT id, title FROM items ORDER BY id').iterate()];
    assert.deepEqual(iterRows, [
      { id: 1, title: 'Alpha' },
      { id: 2, title: 'Beta' },
    ]);

    const getStmt = db.prepare('SELECT COUNT(*) AS cnt FROM items');
    assert.equal(getStmt.timing(false), getStmt);
    assert.equal(getStmt.pluck(true), getStmt);
    assert.equal(getStmt.get(), 2);
    assert.equal(db.prepare('SELECT title FROM items WHERE id = 999').pluck(true).get(), undefined);
    assert.deepEqual(db.prepare('SELECT title FROM items ORDER BY id').pluck(true).all(), ['Alpha', 'Beta']);
    assert.deepEqual([...db.prepare('SELECT title FROM items ORDER BY id').pluck(true).iterate()], ['Alpha', 'Beta']);

    const rawStmt = db.prepare('SELECT id, title FROM items WHERE id = 1').raw(true);
    assert.deepEqual(rawStmt.get(), [1, 'Alpha']);

    const safeStmt = db.prepare('SELECT id FROM items WHERE id = 1').safeIntegers(true);
    assert.equal(typeof safeStmt.pluck(true).get(), 'bigint');

    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('nonexistent_pragma_xyz', { simple: true }), undefined);
    const pragmaRows = db.pragma('table_info(items)');
    assert.equal(Array.isArray(pragmaRows), true);
    assert.equal(pragmaRows.length, 3);
    assert.equal('_metadata' in pragmaRows[0], false);

    db.close();
  });

  it('tracks db.open lifecycle, makes db.close() idempotent, wrapDatabase idempotent, and clears activeDb', () => {
    const db1 = openDatabase(':memory:');
    assert.equal(db1.open, true);
    assert.equal(getActiveDatabase(), db1);
    assert.equal(wrapDatabase(db1), db1);

    const dbNonActive = openDatabase(':memory:', { setActive: false });
    assert.equal(dbNonActive.open, true);
    assert.equal(getActiveDatabase(), db1);
    dbNonActive.close();
    assert.equal(dbNonActive.open, false);
    assert.equal(getActiveDatabase(), db1);

    const MockCtor = makeMockDatabaseClass();
    const wrapped = wrapDatabase(new MockCtor(':memory:'), { mode: 'local', isReplica: false, dbPath: ':memory:' });
    assert.equal(wrapped.open, true);
    wrapped.close();
    wrapped.close();
    assert.equal(wrapped.open, false);
    assert.equal(MockCtor.instances[0].closeCount, 1);

    db1.close();
    assert.equal(db1.open, false);
    assert.equal(getActiveDatabase(), null);
    assert.doesNotThrow(() => db1.close());
  });

  it('supports outer transaction commit/rollback, variants, nested SAVEPOINTs, and SqliteError', () => {
    const db = openDatabase(':memory:', { setActive: false });
    db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, label TEXT UNIQUE)');
    const insert = db.prepare('INSERT INTO entries (label) VALUES (?)');

    const tx = db.transaction((label) => {
      insert.run(label);
      return 'ok';
    });
    assert.equal(tx.database, db);
    assert.equal(tx('m-default'), 'ok');
    assert.equal(tx.default('m-default-2'), 'ok');
    assert.equal(tx.deferred('m-deferred'), 'ok');
    assert.equal(tx.immediate('m-immediate'), 'ok');
    assert.equal(tx.exclusive('m-exclusive'), 'ok');

    assert.throws(() => db.transaction(() => {
      insert.run('outer-rollback');
      throw new Error('boom');
    })(), /boom/);
    assert.equal(db.inTransaction, false);

    db.transaction(() => {
      insert.run('outer-1');
      db.transaction(() => {
        insert.run('inner-1');
      })();
    })();

    db.transaction(() => {
      insert.run('outer-2');
      assert.throws(() => {
        db.transaction(() => {
          insert.run('inner-rolled-back');
          throw new Error('inner-fail');
        })();
      }, /inner-fail/);
      insert.run('outer-2-after');
    })();

    assert.throws(() => {
      db.transaction(() => {
        insert.run('outer-3-lost');
        db.transaction(() => {
          insert.run('inner-3-lost');
        })();
        throw new Error('propagate');
      })();
    }, /propagate/);
    assert.equal(db.inTransaction, false);

    db.transaction(() => {
      insert.run('L1-a');
      db.transaction(() => {
        insert.run('L2-a');
        assert.throws(() => {
          db.transaction(() => {
            insert.run('L3-rolled-back');
            throw new Error('l3-err');
          })();
        }, /l3-err/);
        insert.run('L2-b');
      })();
      insert.run('L1-b');
    })();

    let caughtErr = null;
    try {
      db.transaction(() => {
        insert.run('dup-candidate');
        db.transaction(() => {
          insert.run('dup-candidate');
        })();
      })();
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr instanceof SqliteError);
    assert.equal(caughtErr.code, 'SQLITE_CONSTRAINT_UNIQUE');
    assert.match(caughtErr.message, /UNIQUE constraint failed/);
    assert.equal(db.inTransaction, false);

    assert.deepEqual(
      db.prepare('SELECT label FROM entries ORDER BY id').pluck(true).all(),
      [
        'm-default', 'm-default-2', 'm-deferred', 'm-immediate', 'm-exclusive',
        'outer-1', 'inner-1', 'outer-2', 'outer-2-after',
        'L1-a', 'L2-a', 'L2-b', 'L1-b',
      ]
    );
    db.close();
  });

  it('resolves local vs replica config and enforces safety guards', () => {
    const localCfg = resolveConnectionConfig(undefined, {}, { NODE_ENV: 'production' });
    assert.equal(localCfg.mode, 'local');
    assert.equal(localCfg.isReplica, false);
    assert.equal(localCfg.dbPath, DEFAULT_DB_PATH);
    assert.equal(localCfg.syncPeriod, 0);

    const replicaCfg = resolveConnectionConfig('/tmp/replica.db', {}, {
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'libsql://app-org.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token-xyz',
    });
    assert.equal(replicaCfg.mode, 'replica');
    assert.equal(replicaCfg.isReplica, true);
    assert.equal(replicaCfg.dbPath, '/tmp/replica.db');
    assert.equal(replicaCfg.syncUrl, 'libsql://app-org.turso.io');
    assert.equal(replicaCfg.authToken, 'secret-token-xyz');
    assert.equal(replicaCfg.syncPeriod, 0);
    assert.equal(replicaCfg.readYourWrites, true);

    const localOnlyCfg = resolveConnectionConfig('/tmp/replica.db', { localOnly: true }, {
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'libsql://app-org.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token-xyz',
    });
    assert.equal(localOnlyCfg.mode, 'local');
    assert.equal(localOnlyCfg.isReplica, false);

    const periodCfg = resolveConnectionConfig('/tmp/replica.db', {}, {
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'https://app-org.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token-xyz',
      TURSO_SYNC_PERIOD: '120',
    });
    assert.equal(periodCfg.syncPeriod, 120);

    const memCfg = resolveConnectionConfig(':memory:', {}, {
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'libsql://app-org.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token-xyz',
    });
    assert.equal(memCfg.mode, 'local');
    assert.equal(memCfg.isReplica, false);
    assert.throws(
      () => resolveConnectionConfig(':memory:', { syncUrl: 'libsql://app-org.turso.io', authToken: 'tok' }, {}),
      /Cannot use Turso syncUrl with :memory:/
    );

    const testIgnored = resolveConnectionConfig('/tmp/test.db', {}, {
      NODE_ENV: 'test',
      TURSO_DATABASE_URL: 'libsql://app-org.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token-xyz',
    });
    assert.equal(testIgnored.mode, 'local');
    assert.equal(testIgnored.isReplica, false);

    const testAllowed = resolveConnectionConfig('/tmp/test.db', { allowEnvInTest: true }, {
      NODE_ENV: 'test',
      TURSO_DATABASE_URL: 'libsql://app-org.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token-xyz',
    });
    assert.equal(testAllowed.mode, 'replica');
    assert.equal(testAllowed.isReplica, true);

    const explicitTest = resolveConnectionConfig('/tmp/test.db', {
      syncUrl: 'https://app-org.turso.io',
      authToken: 'explicit-tok',
      syncPeriod: 45,
    }, { NODE_ENV: 'test' });
    assert.equal(explicitTest.mode, 'replica');
    assert.equal(explicitTest.isReplica, true);
    assert.equal(explicitTest.syncPeriod, 45);

    assert.throws(
      () => resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_DATABASE_URL: 'libsql://app-org.turso.io' }),
      /TURSO_AUTH_TOKEN is required/
    );
    assert.throws(
      () => resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_DATABASE_URL: 'https://app-org.turso.io', TURSO_AUTH_TOKEN: '  ' }),
      /TURSO_AUTH_TOKEN is required/
    );
    assert.throws(
      () => resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_DATABASE_URL: 'wss://app-org.turso.io' }),
      /TURSO_AUTH_TOKEN is required/
    );
    assert.throws(
      () => resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_AUTH_TOKEN: 'secret-token-only' }),
      (err) => /TURSO_DATABASE_URL is required/.test(err.message) && !err.message.includes('secret-token-only')
    );
    const httpCfg = resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_DATABASE_URL: 'http://127.0.0.1:8080' });
    assert.equal(httpCfg.mode, 'replica');
    assert.equal(httpCfg.isReplica, true);
    const wsCfg = resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_DATABASE_URL: 'ws://127.0.0.1:8080' });
    assert.equal(wsCfg.mode, 'replica');
    assert.equal(wsCfg.isReplica, true);

    assert.throws(
      () => resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_DATABASE_URL: 'not-a-valid-url', TURSO_AUTH_TOKEN: 'super-secret-value' }),
      (err) => /Invalid TURSO_DATABASE_URL format/.test(err.message) && !err.message.includes('super-secret-value')
    );
    for (const badUrl of ['ftp://example.com/db', 'file:///tmp/local.db']) {
      assert.throws(
        () => resolveConnectionConfig('/tmp/a.db', {}, { NODE_ENV: 'production', TURSO_DATABASE_URL: badUrl, TURSO_AUTH_TOKEN: 'tok' }),
        /Unsupported TURSO_DATABASE_URL protocol/
      );
    }

    for (const badPeriod of ['abc', '-5', 'NaN', 'Infinity']) {
      assert.throws(
        () => resolveConnectionConfig('/tmp/a.db', {}, {
          NODE_ENV: 'production',
          TURSO_DATABASE_URL: 'libsql://app-org.turso.io',
          TURSO_AUTH_TOKEN: 'tok',
          TURSO_SYNC_PERIOD: badPeriod,
        }),
        /TURSO_SYNC_PERIOD must be a non-negative number/
      );
    }
  });

  it('opens local and replica modes via injected DatabaseClass, syncs on startup/close, and cleans up on sync failure', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsj-conn-test-'));
    try {
      const localPath = path.join(tmpDir, 'nested', 'local.db');
      const LocalMock = makeMockDatabaseClass();
      const localDb = openDatabase(localPath, {
        DatabaseClass: LocalMock,
        setActive: false,
        env: { NODE_ENV: 'production' },
      });
      assert.equal(localDb.mode, 'local');
      assert.equal(localDb.isReplica, false);
      assert.deepEqual(LocalMock.instances[0].opts, { timeout: 5000 });
      assert.deepEqual(LocalMock.instances[0].pragmas, ['journal_mode = WAL', 'foreign_keys = ON']);
      assert.equal(LocalMock.instances[0].syncCount, 0);
      localDb.close();
      assert.equal(LocalMock.instances[0].syncCount, 0);
      assert.equal(LocalMock.instances[0].closeCount, 1);

      const replicaPath = path.join(tmpDir, 'nested', 'replica.db');
      const ReplicaMock = makeMockDatabaseClass();
      const replicaDb = openDatabase(replicaPath, {
        DatabaseClass: ReplicaMock,
        setActive: false,
        env: {
          NODE_ENV: 'production',
          TURSO_DATABASE_URL: 'libsql://db-user.turso.io',
          TURSO_AUTH_TOKEN: 'token-123',
          TURSO_SYNC_PERIOD: '45',
        },
      });
      const inst = ReplicaMock.instances[0];
      assert.equal(replicaDb.mode, 'replica');
      assert.equal(replicaDb.isReplica, true);
      assert.deepEqual(inst.opts, {
        syncUrl: 'libsql://db-user.turso.io',
        authToken: 'token-123',
        readYourWrites: true,
        syncPeriod: 45,
      });
      assert.equal(inst.syncCount, 1);
      assert.deepEqual(inst.pragmas, ['foreign_keys = ON']);
      replicaDb.close();
      assert.equal(inst.syncCount, 2);
      assert.equal(inst.closeCount, 1);
      assert.equal(replicaDb.open, false);

      // Default syncPeriod === 0 omits syncPeriod from constructor options
      const NoPeriodMock = makeMockDatabaseClass();
      const noPeriodDb = openDatabase(replicaPath, {
        DatabaseClass: NoPeriodMock,
        setActive: false,
        env: {
          NODE_ENV: 'production',
          TURSO_DATABASE_URL: 'libsql://db-user.turso.io',
          TURSO_AUTH_TOKEN: 'token-123',
        },
      });
      assert.deepEqual(NoPeriodMock.instances[0].opts, {
        syncUrl: 'libsql://db-user.turso.io',
        authToken: 'token-123',
        readYourWrites: true,
      });
      noPeriodDb.close();

      const FailingSyncMock = makeMockDatabaseClass({ failOnSync: true });
      assert.throws(
        () => openDatabase(replicaPath, {
          DatabaseClass: FailingSyncMock,
          setActive: false,
          env: {
            NODE_ENV: 'production',
            TURSO_DATABASE_URL: 'libsql://db-user.turso.io',
            TURSO_AUTH_TOKEN: 'token-123',
          },
        }),
        /simulated startup sync error/
      );
      assert.equal(FailingSyncMock.instances[0].closeCount, 1);
      assert.equal(FailingSyncMock.instances[0].open, false);

      const CloseSyncErrMock = makeMockDatabaseClass({ failSyncOnClose: true });
      const dbCloseErr = openDatabase(replicaPath, {
        DatabaseClass: CloseSyncErrMock,
        env: {
          NODE_ENV: 'production',
          TURSO_DATABASE_URL: 'libsql://db-user.turso.io',
          TURSO_AUTH_TOKEN: 'token-123',
        },
      });
      assert.doesNotThrow(() => dbCloseErr.close());
      assert.equal(dbCloseErr.open, false);
      assert.equal(CloseSyncErrMock.instances[0].closeCount, 1);
      assert.equal(getActiveDatabase(), null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
