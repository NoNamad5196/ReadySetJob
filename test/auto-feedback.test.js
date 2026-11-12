const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { createEssay } = require('../src/services/essaysService');
const { setFetchImpl, resetRateLimit, checkRateLimit, RATE_LIMIT_MAX } = require('../src/services/aiService');
const { waitForBackgroundTasks } = require('../src/services/backgroundTasks');

const FEEDBACK = {
  summary: '자동 생성된 피드백 요약입니다.',
  scores: { specificity: 4, relevance: 4, structure: 3, length_fit: 3 },
  strengths: ['구체적 사례'],
  improvements: [{ issue: '수치 부족', suggestion: '성과를 수치로 쓰세요.', quote: '개선했습니다.' }],
  length_note: '분량 적절',
};

function stubFeedbackFetch(calls) {
  setFetchImpl(async () => {
    calls.push(1);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(FEEDBACK) }] }],
      }),
    };
  });
}

describe('Auto AI feedback on essay version save', () => {
  let ctx, userA, userB, essay;
  const origKey = process.env.OPENAI_API_KEY;

  const feedbackCount = () =>
    ctx.db.prepare('SELECT COUNT(*) AS cnt FROM essay_feedback WHERE essay_id = ?').get(essay.id).cnt;
  const autoFlag = (uid) => ctx.db.prepare('SELECT auto_feedback FROM users WHERE id = ?').get(uid).auto_feedback;
  const saveSettings = (agentCtx, extra) =>
    agentCtx.agent.post('/settings').type('form').send({
      _csrf: agentCtx.csrfToken, name: '사용자', auto_feedback_present: '1', ...extra,
    });
  const saveVersion = (agentCtx, essayId = essay.id) =>
    agentCtx.agent.post(`/essays/${essayId}/versions`).type('form').send({ _csrf: agentCtx.csrfToken, label: '자동' });

  before(async () => {
    delete process.env.OPENAI_API_KEY;
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'fb_a@readysetjob.dev', password: 'password123!', name: '피드백A' });
    userB = await signupAndLogin(ctx.app, { email: 'fb_b@readysetjob.dev', password: 'password123!', name: '피드백B' });
    essay = createEssay(ctx.db, 1, {
      title: '자동 피드백 자소서',
      questions: [
        { question: '지원 동기', char_limit: 500, answer: '서비스 성능을 개선했습니다.' },
        { question: '빈 문항', char_limit: 500, answer: '   ' },
        { question: '협업 경험', char_limit: 500, answer: '팀 프로젝트를 이끌었습니다.' },
      ],
    });
  });

  beforeEach(() => {
    resetRateLimit();
    setFetchImpl(null);
    delete process.env.OPENAI_API_KEY;
    ctx.db.prepare('DELETE FROM essay_feedback').run();
  });

  after(async () => {
    await waitForBackgroundTasks();
    setFetchImpl(null);
    resetRateLimit();
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    else delete process.env.OPENAI_API_KEY;
    ctx.cleanup();
  });

  it('shows a disabled checkbox and keeps the stored value when AI is disabled', async () => {
    const page = await userA.agent.get('/settings');
    assert.match(page.text, /자소서 버전 저장 시 AI 피드백 자동 생성 \(호출 비용 발생\)/);
    assert.match(page.text, /name="auto_feedback"\s+value="1"\s+disabled\s*>/);

    const res = await saveSettings(userA, { auto_feedback: '1' });
    assert.equal(res.status, 302);
    assert.equal(autoFlag(1), 0);
  });

  it('does not call AI or store feedback when auto_feedback is off', async () => {
    process.env.OPENAI_API_KEY = 'sk-auto-feedback';
    const calls = [];
    stubFeedbackFetch(calls);
    await saveSettings(userA, {});
    assert.equal(autoFlag(1), 0);

    const res = await saveVersion(userA);
    assert.equal(res.status, 302);
    await waitForBackgroundTasks();
    assert.equal(calls.length, 0);
    assert.equal(feedbackCount(), 0);
  });

  it('generates feedback for each answered question in the background when enabled, shown on reload', async () => {
    process.env.OPENAI_API_KEY = 'sk-auto-feedback';
    const calls = [];
    stubFeedbackFetch(calls);
    await saveSettings(userA, { auto_feedback: '1' });
    assert.equal(autoFlag(1), 1);

    const res = await saveVersion(userA);
    assert.equal(res.status, 302);
    await waitForBackgroundTasks();
    assert.equal(calls.length, 2);
    assert.equal(feedbackCount(), 2);
    const rows = ctx.db.prepare('SELECT user_id FROM essay_feedback WHERE essay_id = ?').all(essay.id);
    assert.ok(rows.every((r) => r.user_id === 1));

    const editor = await userA.agent.get(`/essays/${essay.id}`);
    assert.match(editor.text, /AI 피드백을 백그라운드에서 생성 중입니다\(잠시 후 새로고침\)/);
    assert.match(editor.text, /자동 생성된 피드백 요약입니다\./);
  });

  it('stops when the shared rate limit is reached', async () => {
    process.env.OPENAI_API_KEY = 'sk-auto-feedback';
    const calls = [];
    stubFeedbackFetch(calls);
    ctx.db.prepare('UPDATE users SET auto_feedback = 1 WHERE id = 1').run();
    for (let i = 0; i < RATE_LIMIT_MAX - 1; i += 1) checkRateLimit(1);

    await saveVersion(userA);
    await waitForBackgroundTasks();
    assert.equal(calls.length, 1);
    assert.equal(feedbackCount(), 1);
  });

  it('swallows background AI errors without affecting the response', async () => {
    process.env.OPENAI_API_KEY = 'sk-auto-feedback';
    ctx.db.prepare('UPDATE users SET auto_feedback = 1 WHERE id = 1').run();
    setFetchImpl(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }));

    const res = await saveVersion(userA);
    assert.equal(res.status, 302);
    await waitForBackgroundTasks();
    assert.equal(feedbackCount(), 0);
  });

  it('preserves ownership: another user cannot version or trigger feedback on the essay', async () => {
    process.env.OPENAI_API_KEY = 'sk-auto-feedback';
    const calls = [];
    stubFeedbackFetch(calls);
    ctx.db.prepare('UPDATE users SET auto_feedback = 1 WHERE id IN (1, 2)').run();

    const res = await saveVersion(userB);
    assert.equal(res.status, 404);
    await waitForBackgroundTasks();
    assert.equal(calls.length, 0);
    assert.equal(feedbackCount(), 0);
  });
});
