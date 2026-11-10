const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');

describe('Kanban Board (/applications/board) & Stage Reordering API', () => {
  let ctx;
  let userA;
  let userB;
  let appIds = [];

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'boarda@readysetjob.dev',
      password: 'passwordA123!',
      name: '보드테스터A',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'boardb@readysetjob.dev',
      password: 'passwordB123!',
      name: '보드테스터B',
    });

    const companies = ['네이버', '카카오', '토스', '당근'];
    for (let i = 0; i < companies.length; i += 1) {
      const jobRes = await userA.agent.post('/jobs').type('form').send({
        _csrf: userA.csrfToken,
        new_company_name: companies[i],
        title: `${companies[i]} 백엔드 채용 ${i + 1}`,
        position: 'Backend Engineer',
        employment_type: i % 2 === 0 ? 'new_grad' : 'intern',
        deadline: '2026-12-20',
      });
      assert.equal(jobRes.status, 302);
      const jobId = Number(jobRes.headers.location.split('/').pop());

      const appRes = await userA.agent.post('/applications').type('form').send({
        _csrf: userA.csrfToken,
        job_post_id: jobId,
        stage: 'document',
        result: 'in_progress',
        applied_at: '2026-11-10',
        memo: `${companies[i]} 지원 메모`,
      });
      assert.equal(appRes.status, 302);
      appIds.push(Number(appRes.headers.location.split('/').pop()));
    }
  });

  after(() => {
    ctx.cleanup();
  });

  it('GET /applications/board returns 200 and contains all 6 Korean column titles and card info', async () => {
    const res = await userA.agent.get('/applications/board');
    assert.equal(res.status, 200);

    const expectedColumns = ['서류', '코딩테스트', '과제', '1차 면접', '2차 면접', '최종'];
    for (const colTitle of expectedColumns) {
      assert.ok(
        res.text.includes(colTitle),
        `Expected board HTML to include column title "${colTitle}"`
      );
    }

    assert.match(res.text, /네이버/);
    assert.match(res.text, /카카오/);
    assert.match(res.text, /보드/);
    assert.match(res.text, /목록/);
    assert.match(res.text, /\/js\/kanban\.js/);

    const filteredRes = await userA.agent.get('/applications/board?q=네이버&result=in_progress');
    assert.equal(filteredRes.status, 200);
    assert.match(filteredRes.text, /네이버/);
  });

  it('PATCH /api/applications/:id/stage with index moves card to target column and renumbers board_order 0..n-1', async () => {
    const db = ctx.app.locals.db;

    // Move first three cards to coding_test at specific indices
    const r1 = await userA.agent
      .patch(`/api/applications/${appIds[0]}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ stage: 'coding_test', index: 0 });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.ok, true);
    assert.equal(r1.body.application.id, appIds[0]);
    assert.equal(r1.body.application.stage, 'coding_test');
    assert.equal(r1.body.application.board_order, 0);

    const r2 = await userA.agent
      .patch(`/api/applications/${appIds[1]}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ stage: 'coding_test', index: 1 });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.ok, true);

    // Insert appIds[2] at index 1 in coding_test (between appIds[0] and appIds[1])
    const r3 = await userA.agent
      .patch(`/api/applications/${appIds[2]}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ stage: 'coding_test', index: 1 });
    assert.equal(r3.status, 200);
    assert.equal(r3.body.ok, true);
    assert.equal(r3.body.application.stage, 'coding_test');
    assert.equal(r3.body.application.board_order, 1);

    const codingTestRows = db
      .prepare(
        'SELECT id, board_order FROM applications WHERE stage = ? ORDER BY board_order ASC'
      )
      .all('coding_test');

    assert.deepEqual(
      codingTestRows.map((r) => ({ id: r.id, board_order: r.board_order })),
      [
        { id: appIds[0], board_order: 0 },
        { id: appIds[2], board_order: 1 },
        { id: appIds[1], board_order: 2 },
      ]
    );

    const docRows = db
      .prepare('SELECT id, board_order FROM applications WHERE stage = ? ORDER BY board_order ASC')
      .all('document');
    assert.deepEqual(
      docRows.map((r) => ({ id: r.id, board_order: r.board_order })),
      [{ id: appIds[3], board_order: 0 }]
    );
  });

  it('reorders cards within the same column and persists board_order sequence', async () => {
    const db = ctx.app.locals.db;

    // Move appIds[1] (currently index 2 in coding_test) to index 0
    const res = await userA.agent
      .patch(`/api/applications/${appIds[1]}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ stage: 'coding_test', index: 0 });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.application.board_order, 0);

    const codingTestRows = db
      .prepare(
        'SELECT id, board_order FROM applications WHERE stage = ? ORDER BY board_order ASC'
      )
      .all('coding_test');

    assert.deepEqual(
      codingTestRows.map((r) => ({ id: r.id, board_order: r.board_order })),
      [
        { id: appIds[1], board_order: 0 },
        { id: appIds[0], board_order: 1 },
        { id: appIds[2], board_order: 2 },
      ]
    );
  });

  it('enforces validation (400/422), ownership (404), and CSRF (403) on stage routes', async () => {
    const invalidRes = await userA.agent
      .patch(`/api/applications/${appIds[0]}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ stage: 'not_a_stage', index: 0 });
    assert.ok(invalidRes.status === 400 || invalidRes.status === 422);

    const otherUserRes = await userB.agent
      .patch(`/api/applications/${appIds[0]}/stage`)
      .set('X-CSRF-Token', userB.csrfToken)
      .send({ stage: 'final', index: 0 });
    assert.equal(otherUserRes.status, 404);

    const noCsrfRes = await userA.agent
      .patch(`/api/applications/${appIds[0]}/stage`)
      .send({ stage: 'final', index: 0 });
    assert.equal(noCsrfRes.status, 403);
  });

  it('POST /applications/:id/stage no-JS fallback updates stage and redirects to board', async () => {
    const postRes = await userA.agent
      .post(`/applications/${appIds[3]}/stage`)
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        stage: 'interview1',
      });
    assert.equal(postRes.status, 302);
    assert.equal(postRes.headers.location, '/applications/board');

    const row = ctx.app.locals.db
      .prepare('SELECT stage, board_order FROM applications WHERE id = ?')
      .get(appIds[3]);
    assert.equal(row.stage, 'interview1');
    assert.equal(row.board_order, 0);
  });
});
