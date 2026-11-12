const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { setFetchImpl, resetRateLimit } = require('../src/services/aiService');
const { waitForBackgroundTasks } = require('../src/services/backgroundTasks');

const AI_QUESTIONS = ['AI 질문 1', 'AI 질문 2', 'AI 질문 3', 'AI 질문 4', 'AI 질문 5'];

function stubInterviewFetch(calls) {
  setFetchImpl(async () => {
    calls.push(1);
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'completed', output_text: JSON.stringify({ questions: AI_QUESTIONS }) }),
    };
  });
}

describe('Auto-organize automation (todos, deadline events, interview AI)', () => {
  let ctx, userA, userB;
  const origKey = process.env.OPENAI_API_KEY;

  const count = (sql, ...params) => ctx.db.prepare(sql).get(...params).cnt;
  const todoCount = (appId, title) =>
    count('SELECT COUNT(*) AS cnt FROM todos WHERE user_id = 1 AND application_id = ? AND title = ?', appId, title);
  const aiQuestionCount = (appId) =>
    count("SELECT COUNT(*) AS cnt FROM interview_questions WHERE application_id = ? AND source = 'ai'", appId);

  async function createJob(agentCtx, { company, title, deadline = '' }) {
    const res = await agentCtx.agent.post('/jobs').type('form').send({
      _csrf: agentCtx.csrfToken, new_company_name: company, title, deadline,
    });
    assert.equal(res.status, 302);
    return Number(res.headers.location.split('/').pop());
  }

  async function createApp(agentCtx, jobId, stage = 'document') {
    const res = await agentCtx.agent.post('/applications').type('form').send({
      _csrf: agentCtx.csrfToken, job_post_id: jobId, stage, result: 'in_progress', applied_at: '2026-11-10',
    });
    assert.equal(res.status, 302);
    return Number(res.headers.location.split('/').pop());
  }

  const patchStage = (agentCtx, appId, stage) =>
    agentCtx.agent.patch(`/api/applications/${appId}/stage`).set('X-CSRF-Token', agentCtx.csrfToken).send({ stage });

  before(async () => {
    delete process.env.OPENAI_API_KEY;
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'auto_a@readysetjob.dev', password: 'password123!', name: '자동A' });
    userB = await signupAndLogin(ctx.app, { email: 'auto_b@readysetjob.dev', password: 'password123!', name: '자동B' });
  });

  beforeEach(() => {
    resetRateLimit();
    setFetchImpl(null);
    delete process.env.OPENAI_API_KEY;
  });

  after(async () => {
    await waitForBackgroundTasks();
    setFetchImpl(null);
    resetRateLimit();
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    else delete process.env.OPENAI_API_KEY;
    ctx.cleanup();
  });

  it('creates one deadline event on job create and links it (no duplicate) on application create, plus one essay todo', async () => {
    const jobId = await createJob(userA, { company: '토스', title: 'FE 공채', deadline: '2026-12-01' });
    const eventTitle = '[토스] FE 공채 서류 마감';
    const orphan = ctx.db.prepare('SELECT * FROM events WHERE user_id = 1 AND title = ?').all(eventTitle);
    assert.equal(orphan.length, 1);
    assert.equal(orphan[0].application_id, null);
    assert.equal(orphan[0].type, 'deadline');
    assert.equal(orphan[0].starts_at, '2026-12-01T18:00');

    const appId = await createApp(userA, jobId);
    const events = ctx.db.prepare('SELECT * FROM events WHERE user_id = 1 AND title = ?').all(eventTitle);
    assert.equal(events.length, 1);
    assert.equal(events[0].application_id, appId);

    const todo = ctx.db
      .prepare('SELECT * FROM todos WHERE user_id = 1 AND application_id = ? AND title = ?')
      .get(appId, '[토스] 자기소개서 작성');
    assert.equal(todo.category, 'essay');
    assert.equal(todo.due_date, '2026-12-01');

    const detail = await userA.agent.get(`/applications/${appId}`);
    assert.match(detail.text, /마감 일정과 할 일이 자동으로 등록되었습니다\./);
  });

  it('skips the deadline event when the job has no deadline but still adds the essay todo', async () => {
    const jobId = await createJob(userA, { company: '카카오', title: '백엔드' });
    const appId = await createApp(userA, jobId);
    assert.equal(count("SELECT COUNT(*) AS cnt FROM events WHERE user_id = 1 AND title LIKE '[카카오]%'"), 0);
    assert.equal(todoCount(appId, '[카카오] 자기소개서 작성'), 1);
  });

  it('creates the interview todo exactly once across every stage-change path, with AI disabled and no fetch', async () => {
    const calls = [];
    stubInterviewFetch(calls);
    const jobId = await createJob(userA, { company: '네이버', title: 'FE', deadline: '2026-12-05' });
    const appId = await createApp(userA, jobId);
    const title = '[네이버] 1차면접 준비';

    const patchRes = await patchStage(userA, appId, 'interview1');
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.auto_todo_created, true);
    assert.equal(todoCount(appId, title), 1);

    const backRes = await userA.agent.post(`/applications/${appId}/stage`).type('form').send({ _csrf: userA.csrfToken, stage: 'document' });
    assert.equal(backRes.status, 302);
    const putRes = await userA.agent.put(`/applications/${appId}`).type('form').send({
      _csrf: userA.csrfToken, stage: 'interview1', result: 'in_progress', applied_at: '2026-11-10',
    });
    assert.equal(putRes.status, 302);
    await waitForBackgroundTasks();

    assert.equal(todoCount(appId, title), 1);
    assert.equal(count('SELECT COUNT(*) AS cnt FROM todos WHERE category = ? AND application_id = ?', 'interview', appId), 1);
    assert.equal(calls.length, 0);
    assert.equal(aiQuestionCount(appId), 0);
  });

  it('generates AI interview questions in the background once when AI is enabled', async () => {
    process.env.OPENAI_API_KEY = 'sk-auto-test';
    const calls = [];
    stubInterviewFetch(calls);
    const jobId = await createJob(userA, { company: '라인', title: '웹' });
    const appId = await createApp(userA, jobId);

    const res = await userA.agent.post(`/applications/${appId}/stage`).type('form').send({ _csrf: userA.csrfToken, stage: 'interview2' });
    assert.equal(res.status, 302);
    await waitForBackgroundTasks();
    assert.equal(aiQuestionCount(appId), 5);
    assert.equal(todoCount(appId, '[라인] 2차면접 준비'), 1);

    await patchStage(userA, appId, 'interview1');
    await waitForBackgroundTasks();
    assert.equal(calls.length, 1, 'skips generation once 3+ AI questions exist');
    assert.equal(aiQuestionCount(appId), 5);
  });

  it('never fails the response when background AI generation errors or the rate limit is exhausted', async () => {
    process.env.OPENAI_API_KEY = 'sk-auto-test';
    setFetchImpl(async () => {
      throw new Error('network down');
    });
    const jobId = await createJob(userA, { company: '쿠팡', title: '커머스' });
    const appId = await createApp(userA, jobId);
    const res = await patchStage(userA, appId, 'interview1');
    assert.equal(res.status, 200);
    await waitForBackgroundTasks();
    assert.equal(aiQuestionCount(appId), 0);

    const { checkRateLimit } = require('../src/services/aiService');
    while (checkRateLimit(1).allowed);
    const calls = [];
    stubInterviewFetch(calls);
    await patchStage(userA, appId, 'interview2');
    await waitForBackgroundTasks();
    assert.equal(calls.length, 0);
    assert.equal(todoCount(appId, '[쿠팡] 2차면접 준비'), 1);
  });

  it('preserves ownership: other users cannot trigger automation on foreign applications', async () => {
    const jobId = await createJob(userA, { company: '당근', title: '웹뷰', deadline: '2026-12-09' });
    const appId = await createApp(userA, jobId);
    const res = await patchStage(userB, appId, 'interview1');
    assert.equal(res.status, 404);
    assert.equal(count('SELECT COUNT(*) AS cnt FROM todos WHERE user_id = 2'), 0);
    assert.equal(count('SELECT COUNT(*) AS cnt FROM events WHERE user_id = 2'), 0);
    assert.equal(todoCount(appId, '[당근] 1차면접 준비'), 0);

    const bJob = await createJob(userB, { company: '당근', title: '웹뷰', deadline: '2026-12-09' });
    await createApp(userB, bJob);
    assert.equal(count("SELECT COUNT(*) AS cnt FROM events WHERE title = '[당근] 웹뷰 서류 마감' AND user_id = 1"), 1);
    assert.equal(count("SELECT COUNT(*) AS cnt FROM events WHERE title = '[당근] 웹뷰 서류 마감' AND user_id = 2"), 1);
  });
});
