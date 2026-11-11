const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { createEssay } = require('../src/services/essaysService');
const { createMaterial } = require('../src/services/materialsService');
const { setFetchImpl, resetRateLimit, getAiConfig } = require('../src/services/aiService');

describe('OpenAI error mapping, model override, settings, and shared rate limit', () => {
  let ctx;
  let userA;
  let essayA;
  let questionA;
  let matA;
  const envBackup = {};
  const ENV_KEYS = [
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_MODEL_INTERVIEW',
    'OPENAI_MODEL_FEEDBACK',
    'OPENAI_MODEL_DRAFT',
    'OPENAI_MODEL_EXTRACT',
  ];

  before(async () => {
    ENV_KEYS.forEach((key) => {
      envBackup[key] = process.env[key];
      delete process.env[key];
    });
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'ai_err@readysetjob.dev',
      password: 'password123!',
      name: '오류사용자',
    });
    essayA = createEssay(ctx.db, 1, {
      title: '오류 자소서',
      questions: [{ question: '지원 동기를 쓰세요.', char_limit: 500, answer: '기존 초안입니다.' }],
    });
    questionA = essayA.questions[0];
    matA = createMaterial(ctx.db, 1, {
      kind: 'experience',
      title: '동아리 운영',
      content: '행사를 기획했습니다.',
    });
  });

  beforeEach(() => {
    resetRateLimit();
    setFetchImpl(null);
    ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  after(() => {
    setFetchImpl(null);
    resetRateLimit();
    ENV_KEYS.forEach((key) => {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key];
      else delete process.env[key];
    });
    ctx.cleanup();
  });

  it('keeps feature models unless OPENAI_MODEL overrides all, and never renders the key', async () => {
    process.env.OPENAI_API_KEY = 'sk-SuperSecretNeverExpose123';
    process.env.OPENAI_MODEL_EXTRACT = 'gpt-extract-custom';
    process.env.OPENAI_MODEL_FEEDBACK = 'gpt-feedback-custom';
    assert.equal(getAiConfig().extract, 'gpt-extract-custom');
    assert.equal(getAiConfig().feedback, 'gpt-feedback-custom');
    assert.equal(getAiConfig().interview, 'gpt-6.1-terra');

    process.env.OPENAI_MODEL = 'gpt-global-override';
    const cfg = getAiConfig();
    assert.equal(cfg.interview, 'gpt-global-override');
    assert.equal(cfg.feedback, 'gpt-global-override');
    assert.equal(cfg.draft, 'gpt-global-override');
    assert.equal(cfg.extract, 'gpt-global-override');
    assert.equal(JSON.stringify(cfg).includes('sk-SuperSecretNeverExpose123'), false);

    const page = await userA.agent.get('/settings/ai');
    assert.equal(page.status, 200);
    assert.match(page.text, /\/home\/box\/projects\/ReadySetJob\/\.env 의 OPENAI_API_KEY/);
    assert.match(page.text, /gpt-global-override/);
    assert.equal(page.text.includes('sk-SuperSecretNeverExpose123'), false);
  });

  it('rejects incomplete, refusal, 401, 429, and 5xx without storing feedback', async () => {
    process.env.OPENAI_API_KEY = 'sk-error-secret';
    const before = ctx.db.prepare('SELECT COUNT(*) AS cnt FROM essay_feedback').get().cnt;
    const cases = [
      {
        stub: { ok: true, status: 200, json: async () => ({ status: 'incomplete', output: [] }) },
        status: 502,
        message: /AI 응답이 완료되지 않았습니다/,
      },
      {
        stub: {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Blocked' }] }],
          }),
        },
        status: 502,
        message: /거부/,
      },
      {
        stub: { ok: false, status: 401, json: async () => ({}) },
        status: 401,
        message: /API 키가 올바르지 않습니다/,
      },
      {
        stub: { ok: false, status: 429, json: async () => ({}) },
        status: 429,
        message: /요청이 많거나 사용 한도를 초과했습니다/,
      },
      {
        stub: { ok: false, status: 503, json: async () => ({}) },
        status: 502,
        message: /AI 서버 응답이 지연되고 있습니다/,
      },
    ];

    for (const item of cases) {
      setFetchImpl(async () => item.stub);
      const res = await userA.agent
        .post(`/api/essays/${essayA.id}/questions/${questionA.id}/feedback`)
        .set('X-CSRF-Token', userA.csrfToken)
        .send({});
      assert.equal(res.status, item.status);
      assert.match(res.body.error, item.message);
    }
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS cnt FROM essay_feedback').get().cnt, before);
  });

  it('shares the 20-call limiter across job parse and STAR draft', async () => {
    process.env.OPENAI_API_KEY = 'sk-limit-secret';
    setFetchImpl(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        output_text: JSON.stringify({
          company_name: '기업',
          title: '공고',
          position: '직무',
          employment_type: 'unknown',
          deadline: '2026-12-31',
          url: 'https://example.com/jobs',
          memo: '메모',
          essay_questions: [],
        }),
      }),
    }));

    for (let i = 0; i < 20; i += 1) {
      const okRes = await userA.agent
        .post('/api/jobs/parse')
        .set('X-CSRF-Token', userA.csrfToken)
        .send({ text: '공고 본문' });
      assert.equal(okRes.status, 200);
      if (i === 0) {
        assert.equal(okRes.body.employment_type, 'unknown');
        assert.equal(okRes.body.url, 'https://example.com/jobs');
      }
    }

    const limited = await userA.agent
      .post(`/api/materials/${matA.id}/star-draft`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({});
    assert.equal(limited.status, 429);
    assert.match(limited.body.error, /한도를 초과했습니다/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS cnt FROM material_star_drafts').get().cnt, 0);
  });
});
