const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  createTestContext,
  fetchCsrfToken,
  signupAndLogin,
  loginAgent,
} = require('./helpers');

describe('Auth, Session, requireAuth, and CSRF Security', () => {
  let ctx;

  before(() => {
    ctx = createTestContext();
  });

  after(() => {
    ctx.cleanup();
  });

  it('redirects unauthenticated HTML requests to /login and returns 401 JSON for /api', async () => {
    const rootRes = await request(ctx.app).get('/');
    assert.equal(rootRes.status, 302);
    assert.equal(rootRes.headers.location, '/login');

    const dashRes = await request(ctx.app).get('/dashboard');
    assert.equal(dashRes.status, 302);
    assert.equal(dashRes.headers.location, '/login');

    const companiesRes = await request(ctx.app).get('/companies');
    assert.equal(companiesRes.status, 302);
    assert.equal(companiesRes.headers.location, '/login');

    const apiRes = await request(ctx.app)
      .get('/api/applications/1/nonexistent')
      .set('Accept', 'application/json');
    assert.equal(apiRes.status, 401);
  });

  it('rejects state-changing requests without a valid CSRF token with 403', async () => {
    const agent = request.agent(ctx.app);
    await fetchCsrfToken(agent, '/signup');

    const noCsrfSignup = await agent.post('/signup').type('form').send({
      email: 'nocsrf@readysetjob.dev',
      password: 'password123!',
      name: '보안테스터',
    });
    assert.equal(noCsrfSignup.status, 403);

    const { agent: authedAgent } = await signupAndLogin(ctx.app, {
      email: 'csrfuser@readysetjob.dev',
      password: 'password123!',
      name: '토큰검증자',
    });

    const noCsrfCompany = await authedAgent.post('/companies').type('form').send({
      name: '토큰없는기업',
    });
    assert.equal(noCsrfCompany.status, 403);

    const noCsrfPatch = await authedAgent
      .patch('/api/applications/1/stage')
      .send({ stage: 'interview1' });
    assert.equal(noCsrfPatch.status, 403);
  });

  it('validates signup email format and minimum 8-char password', async () => {
    const agent = request.agent(ctx.app);
    const csrfToken = await fetchCsrfToken(agent, '/signup');

    const badEmailRes = await agent.post('/signup').type('form').send({
      _csrf: csrfToken,
      email: 'not-an-email',
      password: 'password123!',
      name: '김검증',
    });
    assert.equal(badEmailRes.status, 422);

    const shortPwRes = await agent.post('/signup').type('form').send({
      _csrf: csrfToken,
      email: 'shortpw@readysetjob.dev',
      password: 'short',
      name: '김검증',
    });
    assert.equal(shortPwRes.status, 422);
  });

  it('hashes passwords in SQLite and supports signup -> logout -> login with session regeneration', async () => {
    const email = 'authflow@readysetjob.dev';
    const rawPassword = 'mySecretPassword99!';

    const { agent, csrfToken } = await signupAndLogin(ctx.app, {
      email,
      password: rawPassword,
      name: '이순신',
    });

    const userRow = ctx.db
      .prepare('SELECT email, password_hash, name FROM users WHERE email = ?')
      .get(email);
    assert.ok(userRow);
    assert.notEqual(userRow.password_hash, rawPassword);
    assert.match(userRow.password_hash, /^\$2[aby]\$/);

    const dashRes = await agent.get('/dashboard');
    assert.equal(dashRes.status, 200);
    assert.match(dashRes.text, /이순신/);

    const logoutRes = await agent.post('/logout').type('form').send({
      _csrf: csrfToken,
    });
    assert.equal(logoutRes.status, 302);
    assert.equal(logoutRes.headers.location, '/login');

    const afterLogoutRes = await agent.get('/dashboard');
    assert.equal(afterLogoutRes.status, 302);
    assert.equal(afterLogoutRes.headers.location, '/login');

    const badLoginAgent = request.agent(ctx.app);
    const badLoginCsrf = await fetchCsrfToken(badLoginAgent, '/login');
    const badLoginRes = await badLoginAgent.post('/login').type('form').send({
      _csrf: badLoginCsrf,
      email,
      password: 'wrongPassword123',
    });
    assert.equal(badLoginRes.status, 401);
    assert.match(badLoginRes.text, /이메일 또는 비밀번호가 올바르지 않습니다/);

    const relogin = await loginAgent(ctx.app, {
      email,
      password: rawPassword,
    });
    const dashAfterLogin = await relogin.agent.get('/dashboard');
    assert.equal(dashAfterLogin.status, 200);
    assert.match(dashAfterLogin.text, /이순신/);
  });
});
