const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const {
  createSpecItem,
  getSpecItem,
  listSpecItems,
  updateSpecItem,
  updateSpecStatus,
  deleteSpecItem,
  addWatch,
  removeWatch,
  listWatches,
  readExternalCache,
  writeExternalCache,
} = require('../src/services/specsService');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specs-service-'));
  const db = openDatabase(path.join(dir, 't.db'));
  migrate(db);
  return { db, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function userId(db) {
  return Number(db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('s@x.dev', 'h', 'S')").run().lastInsertRowid);
}

describe('specsService contract', () => {
  let db, uid, cleanup;
  before(() => {
    ({ db, cleanup } = freshDb());
    uid = userId(db);
  });
  after(() => cleanup());

  it('validates kind/source/status/dates/url and trims + limits title to 200', () => {
    const bad = () => createSpecItem(db, uid, { kind: 'nope', title: 'x', source: 'manual' });
    assert.throws(() => createSpecItem(db, uid, { kind: 'certificate', title: 'x', source: 'nope' }), /출처/);
    assert.throws(() => createSpecItem(db, uid, { kind: 'certificate', title: 'x', source: 'manual', status: 'nope' }), /상태/);
    assert.throws(() => bad(), /종류/);
    assert.throws(() => createSpecItem(db, uid, { kind: 'certificate', title: 'x', source: 'manual', apply_start: '2026-02-30' }), /날짜/);
    assert.throws(() => createSpecItem(db, uid, { kind: 'certificate', title: 'x', source: 'manual', source_url: 'javascript:alert(1)' }), /URL/);

    const item = createSpecItem(db, uid, { kind: 'contest', title: '  공모전  ', source: 'ai_verified', status: 'applied' });
    assert.equal(item.title, '공모전');
    assert.equal(item.status, 'applied');
    assert.equal(item.duplicate, false);
    assert.throws(() => createSpecItem(db, uid, { kind: 'contest', title: 'x', apply_start: '2026-12-10', apply_end: '2026-12-01' }), (err) => err.status === 422);

    const long = 'a'.repeat(250);
    assert.throws(() => createSpecItem(db, uid, { kind: 'contest', title: long, source: 'manual' }), /200/);
  });

  it('createSpecItem returns existing row with duplicate:true for same (user, source, source_ref)', () => {
    const first = createSpecItem(db, uid, { kind: 'certificate', title: 'SQLD', source: 'dataq', source_ref: 'SQLD-46' });
    const second = createSpecItem(db, uid, { kind: 'certificate', title: 'SQLD (다른 제목)', source: 'dataq', source_ref: 'SQLD-46' });
    assert.equal(second.id, first.id);
    assert.equal(second.duplicate, true);

    const other = createSpecItem(db, uid, { kind: 'certificate', title: 'SQLD', source: 'manual', source_ref: null });
    assert.equal(other.duplicate, false);
    const otherAgain = createSpecItem(db, uid, { kind: 'certificate', title: 'SQLD', source: 'manual', source_ref: null });
    assert.notEqual(otherAgain.id, other.id);
  });

  it('listSpecItems filters by kind/status/q/from/to and scopes by user', () => {
    const uid2 = Number(db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('s2@x.dev', 'h', 'S2')").run().lastInsertRowid);
    createSpecItem(db, uid, { kind: 'bootcamp', title: 'K-디지털 부트캠프', source: 'work24', source_ref: 'w1', apply_end: '2026-12-01' });
    createSpecItem(db, uid2, { kind: 'bootcamp', title: '타인 부트캠프', source: 'manual' });

    const all = listSpecItems(db, uid);
    assert.ok(all.every((r) => r.user_id === uid));
    assert.equal(listSpecItems(db, uid, { kind: 'bootcamp' }).length, 1);
    assert.equal(listSpecItems(db, uid, { kind: 'bootcamp', status: 'interested' }).length, 1);
    assert.equal(listSpecItems(db, uid, { kind: 'bootcamp', status: 'applied' }).length, 0);
    assert.deepEqual(listSpecItems(db, uid, { status: 'applied' }).map((r) => r.title), ['공모전']);
    assert.equal(listSpecItems(db, uid, { q: '부트캠프' }).length, 1);
    assert.equal(listSpecItems(db, uid2, { q: '부트캠프' })[0].title, '타인 부트캠프');
    assert.equal(listSpecItems(db, uid, { from: '2026-12-01', to: '2026-12-01' }).length, 1);
    assert.equal(listSpecItems(db, uid, { from: '2026-12-02', to: '2026-12-31' }).length, 0);
  });

  it('get/update/delete are user-scoped (null or false on foreign rows)', () => {
    const item = createSpecItem(db, uid, { kind: 'activity', title: '대외활동', source: 'manual' });
    const uid2 = Number(db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('s3@x.dev', 'h', 'S3')").run().lastInsertRowid);
    assert.equal(getSpecItem(db, uid2, item.id), null);
    assert.equal(updateSpecItem(db, uid2, item.id, { title: '해킹' }), null);
    assert.equal(deleteSpecItem(db, uid2, item.id), false);

    const updated = updateSpecItem(db, uid, item.id, { title: '변경된 활동', status: 'in_progress' });
    assert.equal(updated.title, '변경된 활동');
    assert.equal(updated.status, 'in_progress');

    const st = updateSpecStatus(db, uid, item.id, 'dropped');
    assert.equal(st.status, 'dropped');
    assert.throws(() => updateSpecStatus(db, uid, item.id, 'nope'), /상태/);

    assert.equal(deleteSpecItem(db, uid, item.id), true);
    assert.equal(getSpecItem(db, uid, item.id), null);
  });

  it('watch add/remove/list round-trip with idempotent add', () => {
    assert.equal(addWatch(db, uid, { cert_code: '1320', cert_name: '정보처리기사' }).duplicate, false);
    assert.equal(addWatch(db, uid, '1320', '정보처리기사').duplicate, true);
    assert.throws(() => addWatch(db, uid, { cert_code: '../x', cert_name: 'bad' }), (err) => err.status === 422);
    assert.equal(listWatches(db, uid).length, 1);
    assert.equal(listWatches(db, uid)[0].cert_name, '정보처리기사');
    assert.equal(removeWatch(db, uid, '1320'), true);
    assert.equal(removeWatch(db, uid, '1320'), false);
    assert.equal(listWatches(db, uid).length, 0);
  });

  it('external cache honors TTL and stores payload JSON', () => {
    writeExternalCache(db, 'qnet', 'h1', { rows: [1, 2] });
    assert.deepEqual(readExternalCache(db, 'qnet', 'h1', 3600e3).rows, [1, 2]);
    assert.equal(readExternalCache(db, 'qnet', 'h1', -1), null);
    assert.equal(readExternalCache(db, 'qnet', 'missing', 3600e3), null);
    writeExternalCache(db, 'qnet', 'h1', { rows: [3] });
    assert.deepEqual(readExternalCache(db, 'qnet', 'h1', 3600e3).rows, [3]);
  });
});
