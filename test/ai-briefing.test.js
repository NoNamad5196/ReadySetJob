const { it } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { buildBriefingContext, saveBriefing, toIsoDate } = require('../src/services/aiBriefingService');
const { createJobPostWithCompany } = require('../src/services/jobsService');
const { setFetchImpl, resetRateLimit, checkRateLimit } = require('../src/services/aiService');

it('briefing stage totals include applications beyond the ten-item prompt cap and exclude other users', async () => {
  const ctx = createTestContext();
  try {
    await signupAndLogin(ctx.app, { email: 'briefing-count@example.com' });
    await signupAndLogin(ctx.app, { email: 'briefing-other@example.com' });
    for (let index = 0; index < 12; index += 1) {
      const job = createJobPostWithCompany(ctx.db, 1, {
        new_company_name: `내 기업 ${index}`, title: `공고 ${index}`,
      });
      ctx.db.prepare('INSERT INTO applications (user_id, job_post_id, stage) VALUES (?, ?, ?)')
        .run(1, job.id, index === 11 ? 'interview1' : 'document');
    }
    const foreign = createJobPostWithCompany(ctx.db, 2, { new_company_name: '타인 비공개 기업', title: '비공개' });
    ctx.db.prepare('INSERT INTO applications (user_id, job_post_id) VALUES (?, ?)').run(2, foreign.id);
    const { context } = buildBriefingContext(ctx.db, 1);
    assert.equal(context.in_progress_applications.total, 12);
    assert.equal(context.in_progress_applications.items.length, 10);
    assert.equal(Object.values(context.in_progress_applications.by_stage).reduce((sum, count) => sum + count, 0), 12);
    assert.equal(JSON.stringify(context).includes('타인 비공개 기업'), false);
    saveBriefing(ctx.db, 1, { dateStr: '2026-11-12', model: 'stub', result: { headline: '테스트' } });
    ctx.db.prepare('DELETE FROM users WHERE id = ?').run(1);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_briefings WHERE user_id = ?').get(1).count, 0);
  } finally {
    ctx.cleanup();
  }
});

it('search and briefing endpoints enforce CSRF, disabled mode, input validation, and the shared limiter', async () => {
  const key = process.env.OPENAI_API_KEY;
  const ctx = createTestContext();
  try {
    delete process.env.OPENAI_API_KEY;
    resetRateLimit();
    setFetchImpl(async () => { throw new Error('Unexpected external request'); });
    const user = await signupAndLogin(ctx.app, { email: 'ai-boundary@example.com' });
    assert.equal((await user.agent.get('/jobs/discover')).status, 200);
    for (const path of ['/api/jobs/search', '/api/briefing']) {
      assert.equal((await user.agent.post(path).send({})).status, 403);
      const disabled = await user.agent.post(path).set('X-CSRF-Token', user.csrfToken).send({});
      assert.equal(disabled.status, 503);
      assert.match(disabled.body.error, /지금은 사용할 수 없습니다/);
    }
    process.env.OPENAI_API_KEY = 'stub-boundary-key';
    assert.equal((await user.agent.post('/api/jobs/search').set('X-CSRF-Token', user.csrfToken)
      .send({ keyword: '   ' })).status, 422);
    for (let index = 0; index < 20; index += 1) assert.equal(checkRateLimit(1).allowed, true);
    const validSearchPayload = { purpose: 'new_grad', fields: ['백엔드'], region: '서울', keyword: '개발자' };
    for (const path of ['/api/jobs/search', '/api/briefing']) {
      assert.equal((await user.agent.post(path).set('X-CSRF-Token', user.csrfToken)
        .send(validSearchPayload)).status, 429);
    }
    resetRateLimit();
    setFetchImpl(async () => ({ ok: true, json: async () => ({ output_text: 'not JSON' }) }));
    for (const path of ['/api/jobs/search', '/api/briefing']) {
      assert.equal((await user.agent.post(path).set('X-CSRF-Token', user.csrfToken)
        .send(validSearchPayload)).status, 502);
    }
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_briefings').get().count, 0);
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    resetRateLimit();
    setFetchImpl(null);
    ctx.cleanup();
  }
});

it('briefing generation is cached per date and user, refresh replaces one row, and dashboard escapes model text', async () => {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  const briefingModel = process.env.OPENAI_MODEL_BRIEFING;
  const ctx = createTestContext();
  let calls = 0;
  try {
    process.env.OPENAI_API_KEY = 'stub-cache-key';
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_BRIEFING;
    resetRateLimit();
    const userA = await signupAndLogin(ctx.app, { email: 'brief-cache-a@example.com' });
    const userB = await signupAndLogin(ctx.app, { email: 'brief-cache-b@example.com' });
    const own = createJobPostWithCompany(ctx.db, 1, { new_company_name: '내 기업', title: '내 공고' });
    const foreign = createJobPostWithCompany(ctx.db, 2, { new_company_name: '타인 비공개 기업', title: '남의 공고' });
    ctx.db.prepare('INSERT INTO applications (user_id, job_post_id) VALUES (?, ?)').run(1, own.id);
    ctx.db.prepare('INSERT INTO applications (user_id, job_post_id) VALUES (?, ?)').run(2, foreign.id);
    setFetchImpl(async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.tools, undefined);
      assert.equal(init.headers.Authorization, 'Bearer stub-cache-key');
      assert.equal(body.reasoning.effort, 'low');
      assert.equal(body.model, calls === 1 ? 'gpt-6-luna' : calls === 2 ? 'briefing-custom' : 'global-custom');
      assert.equal(body.text.format.type, 'json_schema');
      if (calls < 3) {
        assert.match(body.input, /내 기업/);
        assert.doesNotMatch(body.input, /타인 비공개 기업/);
      }
      return { ok: true, json: async () => ({ output_text: JSON.stringify({
        headline: '<script>unsafe</script>', summary: '이번 주 준비 사항',
        priorities: [{ title: '지원 준비', reason: '서류 검토', href: '/todos' }],
        deadlines: [], encouragement: '차근차근 준비하세요.',
      }) }) };
    });
    assert.equal((await userA.agent.get('/api/briefing')).body.briefing, null);
    const post = (user, payload = {}) => user.agent.post('/api/briefing')
      .set('X-CSRF-Token', user.csrfToken).send(payload);
    assert.equal((await post(userA)).status, 200);
    assert.equal((await post(userA)).body.cached, true);
    assert.equal(calls, 1);
    assert.equal((await userB.agent.get('/api/briefing')).body.briefing, null);
    process.env.OPENAI_MODEL_BRIEFING = 'briefing-custom';
    assert.equal((await post(userA, { force: 1 })).status, 200);
    assert.equal(calls, 2);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_briefings WHERE user_id = ?').get(1).count, 1);
    const page = await userA.agent.get('/dashboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /AI 주간 브리핑/);
    assert.match(page.text, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(page.text, /<script>unsafe<\/script>/);
    process.env.OPENAI_MODEL = 'global-custom';
    assert.equal((await userA.agent.post('/api/briefing?force=1').set('X-CSRF-Token', userA.csrfToken).send({})).status, 200);
    assert.equal(calls, 3);
    assert.equal((await post(userB)).status, 200);
    assert.equal(calls, 4);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    ctx.db.prepare('UPDATE ai_briefings SET briefing_date = ? WHERE user_id = ?').run(toIsoDate(yesterday), 1);
    assert.equal((await userA.agent.get('/api/briefing')).body.briefing, null);
    assert.equal((await post(userA)).body.briefing.briefing_date, toIsoDate(new Date()));
    assert.equal((await post(userA)).body.cached, true);
    assert.equal(calls, 5);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_briefings WHERE user_id = ?').get(1).count, 2);
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
    if (briefingModel === undefined) delete process.env.OPENAI_MODEL_BRIEFING;
    else process.env.OPENAI_MODEL_BRIEFING = briefingModel;
    resetRateLimit();
    setFetchImpl(null);
    ctx.cleanup();
  }
});

it('dashboard card: disabled notice, autoload flag, href allow-list, invalid dates dropped, per-user rendering', async () => {
  const key = process.env.OPENAI_API_KEY;
  const ctx = createTestContext();
  const { toIsoDate } = require('../src/services/aiBriefingService');
  try {
    delete process.env.OPENAI_API_KEY;
    resetRateLimit();
    const userA = await signupAndLogin(ctx.app, { email: 'brief-card-a@example.com' });
    const userB = await signupAndLogin(ctx.app, { email: 'brief-card-b@example.com' });
    const job = createJobPostWithCompany(ctx.db, 1, {
      new_company_name: '토스', title: 'FE 채용', deadline: toIsoDate(new Date(Date.now() + 86400000)),
    });
    const disabledPage = await userA.agent.get('/dashboard');
    assert.match(disabledPage.text, /class="ai-briefing__disabled"/);
    assert.match(disabledPage.text, /data-ai-briefing-autoload="0"/);

    process.env.OPENAI_API_KEY = 'stub-card-key';
    assert.match((await userA.agent.get('/dashboard')).text, /data-ai-briefing-autoload="1"/);
    setFetchImpl(async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({
      headline: '토스 서류 마감 집중 주간', summary: '내일 토스 서류 마감이 있습니다.',
      priorities: [
        { title: '자기소개서 마무리', reason: '내일 마감', href: `/jobs/${job.id}` },
        { title: '외부 링크', reason: '차단', href: 'https://evil.example/phish' },
        { title: '컨텍스트 밖 링크', reason: '차단', href: '/applications/999' },
      ],
      deadlines: [{ label: '토스 서류 마감', date: '2099-01-02' }, { label: '잘못된 날짜', date: '2026-13-45' }],
      encouragement: '할 수 있어요!',
    }) }) }));
    const res = await userA.agent.post('/api/briefing').set('X-CSRF-Token', userA.csrfToken).send({});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.briefing.result.priorities.map((p) => p.href), [`/jobs/${job.id}`, null, null]);
    assert.deepEqual(res.body.briefing.result.deadlines, [{ label: '토스 서류 마감', date: '2099-01-02' }]);

    const page = await userA.agent.get('/dashboard');
    assert.match(page.text, /토스 서류 마감 집중 주간/);
    assert.match(page.text, /data-ai-briefing-autoload="0"/);
    assert.match(page.text, /새로고침/);
    assert.doesNotMatch(page.text, /evil\.example/);
    assert.doesNotMatch((await userB.agent.get('/dashboard')).text, /토스 서류 마감 집중 주간/);
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    resetRateLimit();
    setFetchImpl(null);
    ctx.cleanup();
  }
});
