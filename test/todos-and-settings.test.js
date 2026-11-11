const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createTestContext, signupAndLogin } = require('./helpers');
const { migrate, hasColumn } = require('../src/db/migrate');

describe('Migration Idempotency, Todos, Settings, and Favorites', () => {
  let ctx;
  let userA;
  let userB;
  let appAId;
  let appBId;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'todo_a@readysetjob.dev',
      password: 'passwordA123!',
      name: '투두유저A',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'todo_b@readysetjob.dev',
      password: 'passwordB123!',
      name: '투두유저B',
    });

    const jobARes = await userA.agent.post('/jobs').type('form').send({
      _csrf: userA.csrfToken,
      new_company_name: '토스',
      title: '토스 FE 엔지니어',
      position: 'Frontend Engineer',
    });
    const jobAId = Number(jobARes.headers.location.split('/').pop());
    const appARes = await userA.agent.post('/applications').type('form').send({
      _csrf: userA.csrfToken,
      job_post_id: jobAId,
      stage: 'document',
      result: 'in_progress',
    });
    appAId = Number(appARes.headers.location.split('/').pop());

    const jobBRes = await userB.agent.post('/jobs').type('form').send({
      _csrf: userB.csrfToken,
      new_company_name: '타인기업',
      title: '타인공고',
    });
    const jobBId = Number(jobBRes.headers.location.split('/').pop());
    const appBRes = await userB.agent.post('/applications').type('form').send({
      _csrf: userB.csrfToken,
      job_post_id: jobBId,
      stage: 'document',
      result: 'in_progress',
    });
    appBId = Number(appBRes.headers.location.split('/').pop());
  });

  after(() => {
    ctx.cleanup();
  });

  it('migrates an existing legacy DB idempotently when run twice', () => {
    const legacyDb = new Database(':memory:');
    legacyDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE companies (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL);
      CREATE TABLE job_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company_id INTEGER NOT NULL, title TEXT NOT NULL, deadline DATE);
      CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, job_post_id INTEGER NOT NULL UNIQUE, stage TEXT NOT NULL DEFAULT 'document', result TEXT NOT NULL DEFAULT 'in_progress', board_order INTEGER NOT NULL DEFAULT 0);
    `);

    assert.equal(hasColumn(legacyDb, 'users', 'season_label'), false);
    assert.equal(hasColumn(legacyDb, 'applications', 'is_favorite'), false);

    migrate(legacyDb);
    migrate(legacyDb);

    assert.equal(hasColumn(legacyDb, 'users', 'season_label'), true);
    assert.equal(hasColumn(legacyDb, 'applications', 'is_favorite'), true);

    const tables = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('todos', 'monthly_goals')")
      .all()
      .map((r) => r.name);
    assert.equal(tables.includes('todos'), true);
    assert.equal(tables.includes('monthly_goals'), true);
    legacyDb.close();
  });

  it('supports Todos CRUD, filters, form toggle, JSON PATCH, CSRF, validation, and ownership', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // CSRF required
    assert.equal(
      (await userA.agent.post('/todos').type('form').send({ title: 'CSRF 없는 할 일' })).status,
      403
    );

    // Validation: empty title, >120 title, bad category, bad date
    assert.equal(
      (await userA.agent.post('/todos').type('form').send({ _csrf: userA.csrfToken, title: '' })).status,
      422
    );
    assert.equal(
      (await userA.agent.post('/todos').type('form').send({ _csrf: userA.csrfToken, title: '가'.repeat(121) })).status,
      422
    );
    assert.equal(
      (await userA.agent.post('/todos').type('form').send({ _csrf: userA.csrfToken, title: '유효제목', category: 'bad' })).status,
      422
    );
    assert.equal(
      (await userA.agent.post('/todos').type('form').send({ _csrf: userA.csrfToken, title: '유효제목', due_date: '2026-02-31' })).status,
      422
    );

    // Ownership check on application_id
    assert.equal(
      (await userA.agent.post('/todos').type('form').send({
        _csrf: userA.csrfToken,
        title: '타인 지원 연결 시도',
        application_id: appBId,
      })).status,
      404
    );

    // Create valid todo
    const createRes = await userA.agent.post('/todos').type('form').send({
      _csrf: userA.csrfToken,
      title: '토스 자기소개서 4번 문항 마무리',
      category: 'essay',
      due_date: today,
      application_id: appAId,
    });
    assert.equal(createRes.status, 302);

    const todoRow = ctx.db.prepare('SELECT * FROM todos WHERE user_id = 1 ORDER BY id DESC LIMIT 1').get();
    assert.ok(todoRow);
    assert.equal(todoRow.title, '토스 자기소개서 4번 문항 마무리');
    assert.equal(todoRow.category, 'essay');
    assert.equal(todoRow.application_id, appAId);
    assert.equal(todoRow.is_done, 0);

    const listRes = await userA.agent.get('/todos?filter=today&category=essay');
    assert.equal(listRes.status, 200);
    assert.match(listRes.text, /토스 자기소개서 4번 문항 마무리/);

    const putRes = await userA.agent.put(`/todos/${todoRow.id}`).type('form').send({
      _csrf: userA.csrfToken,
      title: '토스 자기소개서 최종 제출',
      category: 'essay',
      due_date: today,
    });
    assert.equal(putRes.status, 302);

    // POST /todos/:id/toggle with open-redirect guard
    const toggleRes = await userA.agent.post(`/todos/${todoRow.id}/toggle`).type('form').send({
      _csrf: userA.csrfToken,
      redirect_to: 'https://evil.example',
    });
    assert.equal(toggleRes.status, 302);
    assert.equal(toggleRes.headers.location, '/todos');
    assert.equal(ctx.db.prepare('SELECT is_done FROM todos WHERE id = ?').get(todoRow.id).is_done, 1);

    // PATCH /api/todos/:id
    assert.equal(
      (await userA.agent.patch(`/api/todos/${todoRow.id}`).set('X-CSRF-Token', userA.csrfToken).send({ is_done: 'invalid' })).status,
      422
    );

    const okPatch = await userA.agent
      .patch(`/api/todos/${todoRow.id}`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ is_done: false });
    assert.equal(okPatch.status, 200);
    assert.equal(okPatch.body.is_done, 0);

    // User B cannot access User A's todo (404)
    assert.equal(
      (await userB.agent.patch(`/api/todos/${todoRow.id}`).set('X-CSRF-Token', userB.csrfToken).send({ is_done: true })).status,
      404
    );
    assert.equal(
      (await userB.agent.post(`/todos/${todoRow.id}/toggle`).type('form').send({ _csrf: userB.csrfToken })).status,
      404
    );
    assert.equal(
      (await userB.agent.delete(`/todos/${todoRow.id}`).type('form').send({ _csrf: userB.csrfToken })).status,
      404
    );

    assert.equal(
      (await userA.agent.delete(`/todos/${todoRow.id}`).type('form').send({ _csrf: userA.csrfToken })).status,
      302
    );
  });

  it('saves settings (name, season_label, monthly goal) and computes goal progress', async () => {
    assert.equal((await userA.agent.get('/settings')).status, 200);

    assert.equal(
      (await userA.agent.post('/settings').type('form').send({
        _csrf: userA.csrfToken,
        name: '김선우',
        season_label: '2026 하반기 취업 준비',
        target: '250',
      })).status,
      422
    );

    assert.equal(
      (await userA.agent.post('/settings').type('form').send({
        _csrf: userA.csrfToken,
        name: '김선우',
        season_label: '2026 하반기 취업 준비',
        target: '20',
      })).status,
      302
    );

    const afterGet = await userA.agent.get('/settings');
    assert.equal(afterGet.status, 200);
    assert.match(afterGet.text, /김선우/);
    assert.match(afterGet.text, /2026 하반기 취업 준비/);
    assert.match(afterGet.text, /목표 20건/);
    assert.match(afterGet.text, /1건/);
  });

  it('toggles application favorite and enforces ownership', async () => {
    assert.equal(
      (await userA.agent.post(`/applications/${appAId}/favorite`).type('form').send({ _csrf: userA.csrfToken })).status,
      302
    );
    assert.equal(ctx.db.prepare('SELECT is_favorite FROM applications WHERE id = ?').get(appAId).is_favorite, 1);

    const detailRes = await userA.agent.get(`/applications/${appAId}`);
    assert.equal(detailRes.status, 200);
    assert.match(detailRes.text, /즐겨찾기 해제/);

    assert.equal(
      (await userA.agent.post(`/applications/${appAId}/favorite`).type('form').send({ _csrf: userA.csrfToken })).status,
      302
    );
    assert.equal(ctx.db.prepare('SELECT is_favorite FROM applications WHERE id = ?').get(appAId).is_favorite, 0);

    assert.equal(
      (await userB.agent.post(`/applications/${appAId}/favorite`).type('form').send({ _csrf: userB.csrfToken })).status,
      404
    );
  });
});
