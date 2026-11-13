const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { createSpecItem, updateSpecItem, updateSpecStatus, deleteSpecItem } = require('../src/services/specsService');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specs-auto-'));
  const db = openDatabase(path.join(dir, 't.db'));
  migrate(db);
  return { db, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('spec automation (events, todos, material drafts, cleanup)', () => {
  let db, uid, cleanup;
  before(() => {
    ({ db, cleanup } = freshDb());
    uid = Number(db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('a@x.dev', 'h', 'A')").run().lastInsertRowid);
  });
  after(() => cleanup());

  const eventCount = (specId) => db.prepare('SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND spec_item_id = ?').get(uid, specId).c;
  const todoCount = (specId) => db.prepare('SELECT COUNT(*) AS c FROM todos WHERE user_id = ? AND spec_item_id = ?').get(uid, specId).c;
  const events = (specId) => db.prepare('SELECT * FROM events WHERE user_id = ? AND spec_item_id = ? ORDER BY starts_at').all(uid, specId);

  it('creates idempotent apply/test/result events and an apply todo on create', () => {
    const item = createSpecItem(db, uid, {
      kind: 'certificate', title: '정보처리기사', source: 'qnet', source_ref: 'q1',
      apply_start: todayStr(2), apply_end: todayStr(9), event_date: todayStr(30), result_date: todayStr(50),
    });

    assert.equal(eventCount(item.id), 4);
    const titles = events(item.id).map((e) => e.title);
    assert.ok(titles.includes('[정보처리기사] 접수 시작'));
    assert.ok(titles.includes('[정보처리기사] 접수 마감'));
    assert.ok(titles.includes('[정보처리기사] 시험'));
    assert.ok(titles.includes('[정보처리기사] 결과 발표'));

    const deadline = events(item.id).find((e) => e.type === 'deadline');
    assert.equal(deadline.starts_at, `${todayStr(9)}T18:00`);
    const testEv = events(item.id).find((e) => e.type === 'test');
    assert.ok(String(testEv.starts_at).endsWith('T09:00'));
    assert.ok(testEv.memo.includes('자동'));

    const todo = db.prepare('SELECT * FROM todos WHERE user_id = ? AND spec_item_id = ?').get(uid, item.id);
    assert.equal(todo.title, '[정보처리기사] 원서 접수');
    assert.equal(todo.due_date, todayStr(9));
    assert.equal(todo.category, 'other');

    const dup = createSpecItem(db, uid, {
      kind: 'certificate', title: '정보처리기사', source: 'qnet', source_ref: 'q1',
    });
    assert.equal(dup.duplicate, true);
    assert.equal(eventCount(item.id), 4);
    assert.equal(todoCount(item.id), 1);
  });

  it('non-certificate kinds get 신청서 제출 todo and type other event', () => {
    const item = createSpecItem(db, uid, {
      kind: 'bootcamp', title: 'KDT 부트캠프', source: 'work24', source_ref: 'b1', event_date: todayStr(40),
    });
    const todo = db.prepare('SELECT * FROM todos WHERE user_id = ? AND spec_item_id = ?').get(uid, item.id);
    assert.equal(todo.title, '[KDT 부트캠프] 신청서 제출');
    const ev = events(item.id)[0];
    assert.equal(ev.type, 'other');
    assert.equal(ev.title, '[KDT 부트캠프] 시작');
  });

  it('creates the linked schedule and completed submission todo when registered as applied', () => {
    // Given an already submitted activity with a known start date.
    const payload = { kind: 'activity', title: '접수한 서포터즈', status: 'applied', event_date: todayStr(10) };
    // When it is first registered.
    const item = createSpecItem(db, uid, payload);
    // Then its submission history and upcoming schedule are both linked once.
    assert.equal(eventCount(item.id), 1);
    const todo = db.prepare('SELECT is_done FROM todos WHERE user_id = ? AND spec_item_id = ?').get(uid, item.id);
    assert.deepEqual(todo, { is_done: 1 });
  });

  it('re-running schedule sync on an unchanged item creates nothing new', () => {
    const item = createSpecItem(db, uid, {
      kind: 'certificate', title: 'ADsP', source: 'dataq', source_ref: 'adsp-1', apply_end: todayStr(6), event_date: todayStr(21),
    });
    for (let i = 0; i < 3; i += 1) {
      const again = updateSpecItem(db, uid, item.id, {});
      assert.equal(again.automation.eventsCreated, 0);
      assert.equal(again.automation.todoCreated, false);
    }
    assert.equal(eventCount(item.id), 2);
    assert.equal(todoCount(item.id), 1);
  });

  it('re-syncing changed dates updates linked events instead of duplicating', () => {
    const item = createSpecItem(db, uid, {
      kind: 'certificate', title: 'SQLD', source: 'dataq', source_ref: 'd1',
      apply_start: todayStr(1), apply_end: todayStr(8), event_date: todayStr(20), result_date: todayStr(35),
    });
    const updated = updateSpecItem(db, uid, item.id, {
      kind: 'certificate', title: 'SQLD', source: 'dataq', source_ref: 'd1',
      apply_start: todayStr(3), apply_end: todayStr(12), event_date: todayStr(25), result_date: todayStr(45),
      status: 'interested',
    });
    assert.equal(updated.apply_end, todayStr(12));
    assert.equal(eventCount(item.id), 4);
    const deadline = events(item.id).find((e) => e.type === 'deadline');
    assert.equal(deadline.starts_at, `${todayStr(12)}T18:00`);
  });

  it('completed/passed creates exactly one material draft with kind mapping and links material_id', () => {
    const cert = createSpecItem(db, uid, { kind: 'certificate', title: '정보처리기사 실기', source: 'manual', memo: '실기 합격' });
    updateSpecStatus(db, uid, cert.id, 'passed');
    let row = db.prepare('SELECT material_id FROM spec_items WHERE id = ?').get(cert.id);
    const certMat = row.material_id;
    assert.ok(certMat);
    const certKind = db.prepare('SELECT kind, tags, title FROM materials WHERE id = ?').get(certMat);
    assert.equal(certKind.kind, 'award');
    assert.ok(certKind.tags.includes('자격증'));

    updateSpecStatus(db, uid, cert.id, 'completed');
    row = db.prepare('SELECT material_id FROM spec_items WHERE id = ?').get(cert.id);
    assert.equal(row.material_id, certMat);

    const camp = createSpecItem(db, uid, { kind: 'bootcamp', title: '클라우드 부트캠프', source: 'manual', organizer: '고용노동부' });
    updateSpecStatus(db, uid, camp.id, 'completed');
    const campMat = db.prepare('SELECT material_id FROM spec_items WHERE id = ?').get(camp.id).material_id;
    const campKind = db.prepare('SELECT kind FROM materials WHERE id = ?').get(campMat);
    assert.equal(campKind.kind, 'project');
  });

  it('dropped cleans future events and open todos; failed keeps history and creates no material', () => {
    const item = createSpecItem(db, uid, {
      kind: 'contest', title: '공모전', source: 'ai_verified',
      apply_end: todayStr(5), event_date: todayStr(15), result_date: todayStr(25),
    });
    assert.equal(eventCount(item.id), 3);

    db.prepare("INSERT INTO events (user_id, spec_item_id, title, type, starts_at) VALUES (?, ?, '[공모전] 지난 설명회', 'other', ?)")
      .run(uid, item.id, `${todayStr(-3)}T09:00`);
    db.prepare("UPDATE todos SET is_done = 1 WHERE spec_item_id = ? AND user_id = ?").run(item.id, uid);
    db.prepare("INSERT INTO todos (user_id, spec_item_id, title, category) VALUES (?, ?, '[공모전] 아이디어 정리', 'other')").run(uid, item.id);

    updateSpecStatus(db, uid, item.id, 'dropped');
    assert.deepEqual(events(item.id).map((e) => e.title), ['[공모전] 지난 설명회']);
    const left = db.prepare('SELECT is_done FROM todos WHERE user_id = ? AND spec_item_id = ?').all(uid, item.id);
    assert.deepEqual(left.map((t) => t.is_done), [1]);

    const failItem = createSpecItem(db, uid, { kind: 'contest', title: '불합공모전', source: 'manual', event_date: todayStr(15) });
    updateSpecStatus(db, uid, failItem.id, 'failed');
    const row = db.prepare('SELECT material_id FROM spec_items WHERE id = ?').get(failItem.id);
    assert.equal(row.material_id, null);
  });

  it('leaving 관심 marks the auto apply todo done instead of leaving it open', () => {
    const item = createSpecItem(db, uid, { kind: 'activity', title: '서포터즈 9기', source: 'manual', apply_end: todayStr(7) });
    const open = () => db.prepare('SELECT COUNT(*) AS c FROM todos WHERE user_id = ? AND spec_item_id = ? AND is_done = 0').get(uid, item.id).c;
    assert.equal(open(), 1);
    const res = updateSpecStatus(db, uid, item.id, 'applied');
    assert.equal(res.automation.todosCompleted, 1);
    assert.equal(open(), 0);
    assert.equal(todoCount(item.id), 1);
    updateSpecStatus(db, uid, item.id, 'in_progress');
    assert.equal(todoCount(item.id), 1);
  });

  it('delete removes the spec plus linked auto events and todos', () => {
    const item = createSpecItem(db, uid, {
      kind: 'grad_school', title: '대학원', source: 'manual', apply_end: todayStr(4), event_date: todayStr(14),
    });
    assert.ok(eventCount(item.id) >= 2);
    assert.equal(deleteSpecItem(db, uid, item.id), true);
    assert.equal(eventCount(item.id), 0);
    assert.equal(todoCount(item.id), 0);
    const orphan = db.prepare('SELECT COUNT(*) AS c FROM events WHERE spec_item_id = ?').get(item.id).c;
    assert.equal(orphan, 0);
  });
});
