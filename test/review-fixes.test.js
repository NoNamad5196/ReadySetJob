const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createTestContext, signupAndLogin } = require('./helpers');
const { safeRedirectPath, isValidDate, isValidDateTime } = require('../src/middleware/validation');

describe('Code Review Fixes (Part 1: Fixes 1-4)', () => {
  let ctx;
  let user;

  before(async () => {
    ctx = createTestContext();
    user = await signupAndLogin(ctx.app, {
      email: 'fixes1@readysetjob.dev',
      password: 'password123!',
      name: '검증러1',
    });
  });

  after(() => {
    ctx.cleanup();
  });

  it('Fix 1: throws on startup in production if SESSION_SECRET is unset, keeps dev fallback in non-prod', () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.SESSION_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SESSION_SECRET;

      assert.throws(
        () => createApp({ dbPath: ':memory:' }),
        /SESSION_SECRET.*production/i
      );

      process.env.SESSION_SECRET = 'super-secret-prod-key-12345';
      const prodApp = createApp({ dbPath: ':memory:' });
      assert.ok(prodApp);
      prodApp.db.close();

      process.env.NODE_ENV = 'development';
      delete process.env.SESSION_SECRET;
      const devApp = createApp({ dbPath: ':memory:' });
      assert.ok(devApp);
      devApp.db.close();
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origSecret !== undefined) process.env.SESSION_SECRET = origSecret;
      else delete process.env.SESSION_SECRET;
    }
  });

  it('Fix 2: session cookie secure & trust proxy in production, logout clears cookie with matching options', async () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.SESSION_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'test-prod-secret-fixed-cookie';
      const prodApp = createApp({ dbPath: ':memory:' });

      assert.equal(prodApp.get('trust proxy'), 1);

      const agent = request.agent(prodApp);
      const getCsrfRes = await agent.get('/login');
      const csrf = getCsrfRes.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

      const loginRes = await agent
        .post('/signup')
        .set('X-Forwarded-Proto', 'https')
        .type('form')
        .send({
          _csrf: csrf,
          email: 'produser@readysetjob.dev',
          password: 'password123!',
          name: '프로덕션유저',
        });

      const setCookies = loginRes.headers['set-cookie'] || [];
      const sidCookie = setCookies.find((c) => c.startsWith('readysetjob.sid='));
      assert.ok(sidCookie, 'Session cookie should be set upon signup');
      assert.match(sidCookie, /;\s*Secure/i);
      assert.match(sidCookie, /;\s*HttpOnly/i);
      assert.match(sidCookie, /;\s*SameSite=Lax/i);

      prodApp.db.close();
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origSecret !== undefined) process.env.SESSION_SECRET = origSecret;
      else delete process.env.SESSION_SECRET;
    }

    const logoutUser = await signupAndLogin(ctx.app, {
      email: 'logoutuser@readysetjob.dev',
      password: 'password123!',
      name: '로그아웃유저',
    });
    const logoutRes = await logoutUser.agent.post('/logout').type('form').send({
      _csrf: logoutUser.csrfToken,
    });
    assert.equal(logoutRes.status, 302);
    const clearHeaders = logoutRes.headers['set-cookie'] || [];
    const clearedSid = clearHeaders.find((c) => c.startsWith('readysetjob.sid='));
    assert.ok(clearedSid, 'clearCookie header must be sent');
    assert.match(clearedSid, /;\s*Path=\//i);
    assert.match(clearedSid, /;\s*HttpOnly/i);
    assert.match(clearedSid, /;\s*SameSite=Lax/i);
  });

  it('Fix 3: safeRedirectPath blocks evil domains and protocols, sanitizes redirect_to in events/jobs/essays', async () => {
    assert.equal(safeRedirectPath('https://evil.example', '/events'), '/events');
    assert.equal(safeRedirectPath('//evil.example/x', '/events'), '/events');
    assert.equal(safeRedirectPath('/\\evil.example', '/events'), '/events');
    assert.equal(safeRedirectPath('javascript:alert(1)', '/events'), '/events');
    assert.equal(safeRedirectPath('back', '/events'), '/events');
    assert.equal(safeRedirectPath('/applications/1', '/events'), '/applications/1');
    assert.equal(safeRedirectPath('/jobs?q=test', '/jobs'), '/jobs?q=test');

    const evRes = await user.agent.post('/events').type('form').send({
      _csrf: user.csrfToken,
      title: '오픈 리다이렉트 방지 일정',
      type: 'interview',
      starts_at: '2026-12-01T14:00',
      redirect_to: 'https://evil.example',
    });
    assert.equal(evRes.status, 302);
    assert.equal(evRes.headers.location, '/events');

    const jobRes = await user.agent.post('/jobs').type('form').send({
      _csrf: user.csrfToken,
      new_company_name: '리다이렉트테스트사',
      title: '보안 테스트 엔지니어',
      position: 'Security QA',
      employment_type: 'new_grad',
    });
    const jobId = Number(jobRes.headers.location.split('/').pop());

    const bmRes = await user.agent.post(`/jobs/${jobId}/bookmark`).type('form').send({
      _csrf: user.csrfToken,
      redirect_to: '//evil.example/x',
    });
    assert.equal(bmRes.status, 302);
    assert.equal(bmRes.headers.location, `/jobs/${jobId}`);

    const essayRes = await user.agent.post('/essays').type('form').send({
      _csrf: user.csrfToken,
      title: '리다이렉트 자기소개서',
      question: ['질문 1'],
      char_limit: ['1000'],
      answer: ['답변 1'],
    });
    const essayId = Number(essayRes.headers.location.split('/').pop());

    const verRes = await user.agent.post(`/essays/${essayId}/versions`).type('form').send({
      _csrf: user.csrfToken,
      label: 'v1 snapshot',
      redirect_to: '/\\evil.example',
    });
    assert.equal(verRes.status, 302);
    assert.equal(verRes.headers.location, `/essays/${essayId}`);
  });

  it('Fix 4: strict isValidDate and isValidDateTime reject invalid calendars and ranges', async () => {
    assert.equal(isValidDate('2026-02-31'), false);
    assert.equal(isValidDate('2026-04-31'), false);
    assert.equal(isValidDate('2025-02-29'), false);
    assert.equal(isValidDate('2028-02-29'), true);
    assert.equal(isValidDate('2026-11-10'), true);
    assert.equal(isValidDate(''), true);
    assert.equal(isValidDate(null), true);
    assert.equal(isValidDate(undefined), true);
    assert.equal(isValidDate('not-a-date'), false);

    assert.equal(isValidDateTime('January 1, 2026'), false);
    assert.equal(isValidDateTime('2026-02-31T10:00'), false);
    assert.equal(isValidDateTime('2025-02-29T12:00'), false);
    assert.equal(isValidDateTime('2026-11-10T24:00'), false);
    assert.equal(isValidDateTime('2026-11-10T12:60'), false);
    assert.equal(isValidDateTime('2028-02-29T23:59'), true);
    assert.equal(isValidDateTime('2028-02-29T23:59:59'), true);
    assert.equal(isValidDateTime(''), false);
    assert.equal(isValidDateTime(null), false);

    const badJobRes = await user.agent.post('/jobs').type('form').send({
      _csrf: user.csrfToken,
      new_company_name: '날짜검증사',
      title: '날짜오류공고',
      deadline: '2026-02-31',
    });
    assert.equal(badJobRes.status, 422);

    const badEventRes = await user.agent.post('/events').type('form').send({
      _csrf: user.csrfToken,
      title: '일시 오류 일정',
      starts_at: 'January 1, 2026',
    });
    assert.equal(badEventRes.status, 422);
  });
});
