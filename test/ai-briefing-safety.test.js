const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { createJobPostWithCompany } = require('../src/services/jobsService');
const { buildBriefingContext, saveBriefing, toIsoDate } = require('../src/services/aiBriefingService');
const { setFetchImpl, resetRateLimit } = require('../src/services/aiService');

const BRIEFING = {
  headline: '이번 주 지원 준비', summary: '등록된 일정과 할 일을 확인하세요.',
  priorities: [{ title: '서류 점검', reason: '다가오는 마감', href: '/todos' }],
  deadlines: [], encouragement: '차근차근 준비하세요.',
};
const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_MODEL_BRIEFING'];
const response = (result) => ({ ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(result) }) });

describe('AI briefing safety: scoped context, valid cache, and concurrent requests', () => {
  let ctx, user, foreignApplicationId;
  const now = new Date();
  const dateAt = (days) => toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const env = {};
  const post = (payload = {}) => user.agent.post('/api/briefing').set('X-CSRF-Token', user.csrfToken).send(payload);

  before(async () => {
    ENV_KEYS.forEach((key) => { env[key] = process.env[key]; delete process.env[key]; });
    ctx = createTestContext();
    user = await signupAndLogin(ctx.app, { email: 'brief-safe-own@example.com' });
    await signupAndLogin(ctx.app, { email: 'brief-safe-other@example.com' });
    const own = createJobPostWithCompany(ctx.db, 1, { new_company_name: '내 기업', title: '내 공고', deadline: dateAt(2) });
    const foreign = createJobPostWithCompany(ctx.db, 2, { new_company_name: '타인 비공개 기업', title: '타인 비공개 공고', deadline: dateAt(2) });
    const ownApp = ctx.db.prepare('INSERT INTO applications (user_id, job_post_id, stage, applied_at) VALUES (?, ?, ?, ?)')
      .run(1, own.id, 'interview1', dateAt(0)).lastInsertRowid;
    foreignApplicationId = Number(ctx.db.prepare('INSERT INTO applications (user_id, job_post_id) VALUES (?, ?)').run(2, foreign.id).lastInsertRowid);
    createJobPostWithCompany(ctx.db, 1, { new_company_name: '내 먼 기업', title: '기간 밖 공고', deadline: dateAt(8) });
    const event = ctx.db.prepare('INSERT INTO events (user_id, application_id, title, type, starts_at) VALUES (?, ?, ?, ?, ?)');
    event.run(1, ownApp, '내 면접', 'interview', dateAt(2) + 'T10:00');
    event.run(2, foreignApplicationId, '타인 비공개 일정', 'interview', dateAt(2) + 'T10:00');
    event.run(1, foreignApplicationId, '내 일정의 잘못된 연결', 'other', dateAt(2) + 'T11:00');
    event.run(1, ownApp, '기간 밖 일정', 'other', dateAt(8) + 'T10:00');
    event.run(1, ownApp, '지난 일정', 'other', dateAt(-1) + 'T10:00');
    for (let i = 0; i < 10; i += 1) event.run(1, ownApp, '긴 일정 ' + 'x'.repeat(1600), 'other', dateAt(3) + 'T10:00');
    const todo = ctx.db.prepare('INSERT INTO todos (user_id, title, due_date, is_done) VALUES (?, ?, ?, ?)');
    todo.run(1, '내 열린 할 일', dateAt(1), 0);
    todo.run(1, '완료된 할 일', dateAt(1), 1);
    todo.run(2, '타인 비공개 할 일', dateAt(1), 0);
    const goal = ctx.db.prepare('INSERT INTO monthly_goals (user_id, month, target) VALUES (?, ?, ?)');
    goal.run(1, dateAt(0).slice(0, 7), 7);
    goal.run(2, dateAt(0).slice(0, 7), 83);
  });

  beforeEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    process.env.OPENAI_API_KEY = 'stub-safety-key';
    resetRateLimit();
    setFetchImpl(async () => { throw new Error('Unexpected external request'); });
    ctx.db.prepare('DELETE FROM ai_briefings').run();
  });

  after(() => {
    ENV_KEYS.forEach((key) => { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; });
    setFetchImpl(null);
    resetRateLimit();
    ctx.cleanup();
  });

  it('uses only owned deadlines, next-week events, open todos, stage counts, and this-month goal', () => {
    const { context, allowedHrefs } = buildBriefingContext(ctx.db, 1, now);
    assert.deepEqual(context.deadlines_next_7_days.map((d) => d.title), ['내 공고']);
    assert.ok(context.events_next_7_days.some((e) => e.title === '내 면접'));
    assert.deepEqual(context.open_todos.map((t) => t.title), ['내 열린 할 일']);
    assert.equal(context.in_progress_applications.total, 1);
    assert.equal(context.in_progress_applications.by_stage['1차면접'], 1);
    assert.deepEqual(context.monthly_goal, { month: dateAt(0).slice(0, 7), target: 7, current: 1 });
    assert.doesNotMatch(JSON.stringify(context), /타인 비공개|기간 밖|지난 일정|완료된 할 일/);
    assert.equal(allowedHrefs.includes(`/applications/${foreignApplicationId}`), false);
  });

  it('sends complete bounded server-owned JSON instead of truncating away the goal or accepting client context', async () => {
    let body;
    setFetchImpl(async (_url, init) => { body = JSON.parse(init.body); return response(BRIEFING); });
    assert.equal((await post({ user_id: 2, context: { headline: 'injected-client-context' } })).status, 200);
    const context = JSON.parse(body.input.replace(/^<user_data>\n|\n<\/user_data>$/g, ''));
    assert.equal(context.monthly_goal.target, 7);
    assert.equal(context.events_next_7_days.length, 10);
    assert.ok(context.events_next_7_days.every((e) => e.title.length <= 200));
    assert.doesNotMatch(body.input, /타인 비공개|injected-client-context/);
  });

  it('returns 502 for incomplete briefing structures and never caches them', async () => {
    const cases = [{ headline: '제목만', summary: '요약만' }, { ...BRIEFING, priorities: null }, { ...BRIEFING, deadlines: {} }, { ...BRIEFING, encouragement: null }];
    for (const result of cases) {
      setFetchImpl(async () => response(result));
      assert.equal((await post()).status, 502);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_briefings').get().count, 0);
    }
  });

  it('ignores malformed cached results without breaking GET /api/briefing or the dashboard', async () => {
    saveBriefing(ctx.db, 1, { dateStr: dateAt(0), model: 'stub', result: { headline: '잘못된 캐시' } });
    assert.equal((await user.agent.get('/api/briefing')).body.briefing, null);
    const page = await user.agent.get('/dashboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /data-ai-briefing-autoload="1"/);
    setFetchImpl(async () => response(BRIEFING));
    assert.equal((await post()).body.briefing.result.headline, BRIEFING.headline);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_briefings WHERE user_id = ?').get(1).count, 1);
  });

  it('coalesces simultaneous generation into one fetch and one cache row', async () => {
    const started = Promise.withResolvers();
    const released = Promise.withResolvers();
    let calls = 0;
    setFetchImpl(async () => { calls += 1; started.resolve(); await released.promise; return response(BRIEFING); });
    const first = post().then((res) => res);
    await started.promise;
    const second = post().then((res) => res);
    const timer = setTimeout(() => released.resolve(), 50);
    try {
      const results = await Promise.all([first, second]);
      assert.deepEqual(results.map((res) => res.status), [200, 200]);
      assert.equal(calls, 1);
      assert.equal(results[0].body.briefing.id, results[1].body.briefing.id);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_briefings').get().count, 1);
    } finally {
      clearTimeout(timer);
      released.resolve();
    }
  });
});
