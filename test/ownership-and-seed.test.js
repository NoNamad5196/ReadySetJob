const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin, loginAgent } = require('./helpers');
const { seed } = require('../src/db/seed');

describe('Ownership Isolation and Korean Demo Seed', () => {
  let ctx;
  let userA;
  let userB;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'ownera@readysetjob.dev',
      password: 'passwordA123!',
      name: '소유자A',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'ownerb@readysetjob.dev',
      password: 'passwordB123!',
      name: '타인B',
    });
  });

  after(() => {
    ctx.cleanup();
  });

  it("enforces ownership: user B gets 404 when reading, updating, or deleting user A's resources", async () => {
    const jobRes = await userA.agent.post('/jobs').type('form').send({
      _csrf: userA.csrfToken,
      new_company_name: '네이버',
      title: '네이버 백엔드 공채',
      position: 'Backend',
      employment_type: 'new_grad',
    });
    const jobId = Number(jobRes.headers.location.split('/').pop());
    const companyId = ctx.db
      .prepare('SELECT company_id FROM job_posts WHERE id = ?')
      .get(jobId).company_id;

    const appRes = await userA.agent.post('/applications').type('form').send({
      _csrf: userA.csrfToken,
      job_post_id: jobId,
      stage: 'document',
      result: 'in_progress',
    });
    const appId = Number(appRes.headers.location.split('/').pop());

    assert.equal((await userB.agent.get(`/companies/${companyId}`)).status, 404);
    assert.equal(
      (
        await userB.agent
          .post(`/companies/${companyId}?_method=PUT`)
          .type('form')
          .send({ _csrf: userB.csrfToken, _method: 'PUT', name: '해킹시도' })
      ).status,
      404
    );
    assert.equal(
      (
        await userB.agent
          .post(`/companies/${companyId}?_method=DELETE`)
          .type('form')
          .send({ _csrf: userB.csrfToken, _method: 'DELETE' })
      ).status,
      404
    );

    assert.equal((await userB.agent.get(`/jobs/${jobId}`)).status, 404);
    assert.equal(
      (
        await userB.agent
          .post(`/jobs/${jobId}?_method=PUT`)
          .type('form')
          .send({
            _csrf: userB.csrfToken,
            _method: 'PUT',
            company_id: companyId,
            title: '해킹공고',
            employment_type: 'new_grad',
          })
      ).status,
      404
    );
    assert.equal(
      (
        await userB.agent
          .post(`/jobs/${jobId}/bookmark`)
          .type('form')
          .send({ _csrf: userB.csrfToken })
      ).status,
      404
    );
    assert.equal(
      (
        await userB.agent
          .post(`/jobs/${jobId}?_method=DELETE`)
          .type('form')
          .send({ _csrf: userB.csrfToken, _method: 'DELETE' })
      ).status,
      404
    );

    assert.equal((await userB.agent.get(`/applications/${appId}`)).status, 404);
    assert.equal(
      (
        await userB.agent
          .patch(`/api/applications/${appId}/stage`)
          .set('X-CSRF-Token', userB.csrfToken)
          .send({ stage: 'final', result: 'passed' })
      ).status,
      404
    );
    assert.equal(
      (
        await userB.agent
          .post(`/applications/${appId}?_method=DELETE`)
          .type('form')
          .send({ _csrf: userB.csrfToken, _method: 'DELETE' })
      ).status,
      404
    );
  });

  it('seeds Korean demo user and sample companies/jobs/applications cleanly', async () => {
    const seedResult = seed(ctx.db);
    assert.equal(seedResult.demoEmail, 'demo@readysetjob.dev');

    const demoLogin = await loginAgent(ctx.app, {
      email: 'demo@readysetjob.dev',
      password: 'demo1234!',
    });
    const companiesPage = await demoLogin.agent.get('/companies');
    assert.equal(companiesPage.status, 200);
    assert.match(companiesPage.text, /네이버/);
    assert.match(companiesPage.text, /카카오/);
    assert.match(companiesPage.text, /토스/);
    assert.match(companiesPage.text, /당근/);
    assert.match(companiesPage.text, /라인플러스/);
  });
});
