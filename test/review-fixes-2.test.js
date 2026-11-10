const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, signupAndLogin, fetchCsrfToken } = require('./helpers');
const { parseId } = require('../src/middleware/validation');
const { createCompany } = require('../src/services/companiesService');
const { createJobPostWithCompany } = require('../src/services/jobsService');
const { createApplication } = require('../src/services/applicationsService');
const { createEssay, saveEssayDraft } = require('../src/services/essaysService');
const { createEvent } = require('../src/services/eventsService');
const { createUser } = require('../src/services/usersService');

describe('Code Review Fixes (Part 2: Fixes 5-9)', () => {
  let ctx;
  let userA;
  let userB;
  let jobId;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'fixes2-a@readysetjob.dev',
      password: 'password123!',
      name: '사용자A',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'fixes2-b@readysetjob.dev',
      password: 'password123!',
      name: '사용자B',
    });

    const company = createCompany(ctx.db, userA.agent.userId || 1, {
      name: '순서검증테크',
      industry: 'IT',
    });
    const job = createJobPostWithCompany(ctx.db, userA.agent.userId || 1, {
      company_id: company.id,
      title: '백엔드 엔지니어',
      position: 'Backend',
      employment_type: 'new_grad',
    });
    jobId = job.id;
  });

  after(() => {
    ctx.cleanup();
  });

  it('Fix 5: PUT stage move appends to column and compacts both columns 0..n-1; delete compacts column', async () => {
    const uid = 1;
    const app1 = createApplication(ctx.db, uid, { job_post_id: jobId, stage: 'document', board_order: 0 });
    const job2 = createJobPostWithCompany(ctx.db, uid, { company_id: app1.company_id, title: '웹 엔지니어', position: 'Web', employment_type: 'new_grad' });
    const app2 = createApplication(ctx.db, uid, { job_post_id: job2.id, stage: 'document', board_order: 1 });
    const job3 = createJobPostWithCompany(ctx.db, uid, { company_id: app1.company_id, title: '서버 엔지니어', position: 'Server', employment_type: 'new_grad' });
    const app3 = createApplication(ctx.db, uid, { job_post_id: job3.id, stage: 'document', board_order: 2 });
    const job4 = createJobPostWithCompany(ctx.db, uid, { company_id: app1.company_id, title: '데이터 엔지니어', position: 'Data', employment_type: 'new_grad' });
    const app4 = createApplication(ctx.db, uid, { job_post_id: job4.id, stage: 'coding_test', board_order: 0 });

    const moveRes = await userA.agent.put(`/applications/${app2.id}`).type('form').send({
      _csrf: userA.csrfToken,
      stage: 'coding_test',
      result: 'in_progress',
    });
    assert.equal(moveRes.status, 302);

    const docApps = ctx.db.prepare('SELECT id, board_order FROM applications WHERE user_id = ? AND stage = ? ORDER BY board_order ASC').all(uid, 'document');
    assert.deepEqual(docApps.map((a) => a.board_order), [0, 1]);
    assert.deepEqual(docApps.map((a) => a.id), [app1.id, app3.id]);

    const codeApps = ctx.db.prepare('SELECT id, board_order FROM applications WHERE user_id = ? AND stage = ? ORDER BY board_order ASC').all(uid, 'coding_test');
    assert.deepEqual(codeApps.map((a) => a.board_order), [0, 1]);
    assert.deepEqual(codeApps.map((a) => a.id), [app4.id, app2.id]);

    const delRes = await userA.agent.delete(`/applications/${app4.id}`).type('form').send({
      _csrf: userA.csrfToken,
    });
    assert.equal(delRes.status, 302);

    const remainingCode = ctx.db.prepare('SELECT id, board_order FROM applications WHERE user_id = ? AND stage = ? ORDER BY board_order ASC').all(uid, 'coding_test');
    assert.deepEqual(remainingCode.map((a) => a.board_order), [0]);
    assert.equal(remainingCode[0].id, app2.id);
  });

  it('Fix 6: PATCH /api/applications/:id/stage rejects non-integer board_order and bad input with 422/404', async () => {
    const uid = 1;
    const job5 = createJobPostWithCompany(ctx.db, uid, { new_company_name: '패치테스트사', title: 'QA', position: 'QA', employment_type: 'new_grad' });
    const app = createApplication(ctx.db, uid, { job_post_id: job5.id, stage: 'document', board_order: 0 });

    const badOrderRes = await userA.agent.patch(`/api/applications/${app.id}/stage`).set('X-CSRF-Token', userA.csrfToken).send({
      stage: 'coding_test',
      board_order: 'invalid-string',
    });
    assert.equal(badOrderRes.status, 422);

    const floatOrderRes = await userA.agent.patch(`/api/applications/${app.id}/stage`).set('X-CSRF-Token', userA.csrfToken).send({
      stage: 'coding_test',
      board_order: 1.5,
    });
    assert.equal(floatOrderRes.status, 422);

    const badIndexRes = await userA.agent.patch(`/api/applications/${app.id}/stage`).set('X-CSRF-Token', userA.csrfToken).send({
      stage: 'coding_test',
      index: 'invalid-index',
    });
    assert.equal(badIndexRes.status, 422);

    const badIdRes = await userA.agent.patch('/api/applications/notanid/stage').set('X-CSRF-Token', userA.csrfToken).send({
      stage: 'coding_test',
    });
    assert.equal(badIdRes.status, 404);
  });

  it('Fix 7: createEssay/saveEssayDraft verifies application_id ownership inside transaction with 404 expose:true', async () => {
    const userAApp = ctx.db.prepare('SELECT id FROM applications WHERE user_id = 1 LIMIT 1').get();
    assert.ok(userAApp);

    assert.throws(
      () => createEssay(ctx.db, 2, { title: 'B의 자소서', application_id: userAApp.id }),
      (err) => err.status === 404 && err.expose === true
    );

    const essayB = createEssay(ctx.db, 2, { title: 'B의 독립 자소서', application_id: null, questions: [{ question: 'Q', answer: 'A' }] });
    assert.throws(
      () => saveEssayDraft(ctx.db, 2, { essayId: essayB.id, application_id: userAApp.id }),
      (err) => err.status === 404 && err.expose === true
    );
  });

  it('Fix 8: parseId validates positive integers and prevents non-numeric ids producing 500 or silent null', async () => {
    assert.equal(parseId(10), 10);
    assert.equal(parseId('10'), 10);
    assert.equal(parseId('  42  '), 42);
    assert.equal(parseId(0), null);
    assert.equal(parseId('-5'), null);
    assert.equal(parseId('1.5'), null);
    assert.equal(parseId('abc'), null);
    assert.equal(parseId(''), null);
    assert.equal(parseId(null), null);
    assert.equal(parseId(undefined), null);
    assert.equal(parseId(true), null);

    assert.equal((await userA.agent.get('/companies/abc')).status, 404);
    assert.equal((await userA.agent.get('/jobs/abc')).status, 404);
    assert.equal((await userA.agent.get('/applications/abc')).status, 404);
    assert.equal((await userA.agent.get('/essays/abc')).status, 404);
    assert.equal((await userA.agent.get('/materials/abc')).status, 404);
    assert.equal((await userA.agent.get('/essays/1/versions/abc')).status, 404);

    const badJobBody = await userA.agent.post('/jobs').type('form').send({
      _csrf: userA.csrfToken,
      title: '공고',
      company_id: 'bad-id',
    });
    assert.equal(badJobBody.status, 422);

    const badAppBody = await userA.agent.post('/applications').type('form').send({
      _csrf: userA.csrfToken,
      job_post_id: 'bad-id',
    });
    assert.equal(badAppBody.status, 422);

    const badEventBody = await userA.agent.post('/events').type('form').send({
      _csrf: userA.csrfToken,
      title: '일정',
      application_id: 'bad-id',
      starts_at: '2026-11-20T14:00',
    });
    assert.equal(badEventBody.status, 422);

    assert.throws(
      () => createEvent(ctx.db, 1, { application_id: 999999, title: '일정', starts_at: '2026-11-20T14:00' }),
      (err) => err.status === 404 && err.expose === true
    );
  });

  it('Fix 9: signup duplicate email catches SQLITE_CONSTRAINT_UNIQUE race and returns 422 (no 500)', async () => {
    createUser(ctx.db, { email: 'race-test@readysetjob.dev', password: 'password123!', name: '기존유저' });

    const agent = request.agent(ctx.app);
    const csrfToken = await fetchCsrfToken(agent, '/signup');

    const signupRes = await agent.post('/signup').type('form').send({
      _csrf: csrfToken,
      email: 'race-test@readysetjob.dev',
      password: 'password123!',
      name: '동일이메일유저',
    });
    assert.equal(signupRes.status, 422);
    assert.match(signupRes.text, /이미 사용 중인 이메일입니다/);
  });
});
