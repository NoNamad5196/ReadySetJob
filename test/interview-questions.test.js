const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { createJobPostWithCompany } = require('../src/services/jobsService');
const { createApplication } = require('../src/services/applicationsService');
const { list, createManual, deleteQuestion } = require('../src/services/interviewQuestionsService');
const { setFetchImpl, resetRateLimit } = require('../src/services/aiService');

describe('Interview Questions Feature', () => {
  let ctx, userA, userB, appA, appB;
  const origKey = process.env.GEMINI_API_KEY;
  const origModel = process.env.GEMINI_MODEL;

  before(async () => {
    delete process.env.GEMINI_API_KEY;
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'iq_a@readysetjob.dev', password: 'password123!', name: '소유자A' });
    userB = await signupAndLogin(ctx.app, { email: 'iq_b@readysetjob.dev', password: 'password123!', name: '타인B' });

    const jobA = createJobPostWithCompany(ctx.db, 1, { new_company_name: '토스', title: '서버 개발자', position: 'Backend' });
    appA = createApplication(ctx.db, 1, { job_post_id: jobA.id, stage: 'document' });

    const jobB = createJobPostWithCompany(ctx.db, 2, { new_company_name: '카카오', title: '프론트 개발자', position: 'Frontend' });
    appB = createApplication(ctx.db, 2, { job_post_id: jobB.id, stage: 'document' });
  });

  after(() => {
    setFetchImpl(null);
    resetRateLimit();
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey;
    else delete process.env.GEMINI_API_KEY;
    if (origModel !== undefined) process.env.GEMINI_MODEL = origModel;
    else delete process.env.GEMINI_MODEL;
    ctx.cleanup();
  });

  it('manual add, list, and delete workflow', async () => {
    const postRes = await userA.agent.post(`/applications/${appA.id}/interview-questions`).type('form').send({
      _csrf: userA.csrfToken,
      question: '이직 사유와 당사 지원 동기를 말씀해 주세요.',
    });
    assert.equal(postRes.status, 302);
    assert.equal(postRes.headers.location, `/applications/${appA.id}`);

    const detailRes = await userA.agent.get(`/applications/${appA.id}`);
    assert.equal(detailRes.status, 200);
    assert.match(detailRes.text, /이직 사유와 당사 지원 동기를 말씀해 주세요\./);
    assert.match(detailRes.text, /직접 작성/);

    const questions = list(ctx.db, 1, appA.id);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].source, 'manual');

    const delRes = await userA.agent
      .post(`/applications/${appA.id}/interview-questions/${questions[0].id}?_method=DELETE`)
      .type('form')
      .send({ _csrf: userA.csrfToken, _method: 'DELETE' });
    assert.equal(delRes.status, 302);

    const afterDel = await userA.agent.get(`/applications/${appA.id}`);
    assert.doesNotMatch(afterDel.text, /이직 사유와 당사 지원 동기를 말씀해 주세요\./);
    assert.equal(list(ctx.db, 1, appA.id).length, 0);
  });

  it('validation 422 on empty or overly long questions', async () => {
    const emptyRes = await userA.agent.post(`/applications/${appA.id}/interview-questions`).type('form').send({
      _csrf: userA.csrfToken,
      question: '   ',
    });
    assert.equal(emptyRes.status, 422);
    assert.match(emptyRes.text, /면접 질문을 1자 이상 500자 이하로 입력해 주세요/);

    const longRes = await userA.agent.post(`/applications/${appA.id}/interview-questions`).type('form').send({
      _csrf: userA.csrfToken,
      question: '질'.repeat(501),
    });
    assert.equal(longRes.status, 422);

    assert.throws(
      () => createManual(ctx.db, 1, appA.id, ''),
      (err) => err.status === 422 && err.expose === true
    );
  });

  it('enforces ownership: other user gets 404', async () => {
    const q = createManual(ctx.db, 1, appA.id, 'A의 질문');
    assert.equal((await userB.agent.post(`/applications/${appA.id}/interview-questions`).type('form').send({ _csrf: userB.csrfToken, question: 'B의 침범' })).status, 404);
    assert.equal((await userB.agent.post(`/applications/${appA.id}/interview-questions/${q.id}?_method=DELETE`).type('form').send({ _csrf: userB.csrfToken, _method: 'DELETE' })).status, 404);
    assert.equal((await userB.agent.post(`/applications/${appA.id}/interview-questions/generate`).type('form').send({ _csrf: userB.csrfToken })).status, 404);

    assert.throws(() => list(ctx.db, 2, appA.id), (err) => err.status === 404 && err.expose === true);
    assert.throws(() => deleteQuestion(ctx.db, 2, q.id), (err) => err.status === 404 && err.expose === true);
    deleteQuestion(ctx.db, 1, q.id);
  });

  it('rejects state-changing requests without CSRF token with 403', async () => {
    assert.equal((await userA.agent.post(`/applications/${appA.id}/interview-questions`).type('form').send({ question: 'CSRF 없음' })).status, 403);
    assert.equal((await userA.agent.post(`/applications/${appA.id}/interview-questions/999?_method=DELETE`).type('form').send({ _method: 'DELETE' })).status, 403);
    assert.equal((await userA.agent.post(`/applications/${appA.id}/interview-questions/generate`).type('form').send({})).status, 403);
  });

  it('generate with AI disabled creates no rows and shows disabled explanation', async () => {
    delete process.env.GEMINI_API_KEY;
    const detailRes = await userA.agent.get(`/applications/${appA.id}`);
    assert.match(detailRes.text, /AI 기능이 비활성화되어 있습니다 \(GEMINI_API_KEY 미설정\)/);
    assert.match(detailRes.text, /disabled/);

    const genRes = await userA.agent.post(`/applications/${appA.id}/interview-questions/generate`).type('form').send({ _csrf: userA.csrfToken });
    assert.equal(genRes.status, 302);

    const redirectRes = await userA.agent.get(`/applications/${appA.id}`);
    assert.match(redirectRes.text, /AI 기능이 비활성화되어 있습니다 \(GEMINI_API_KEY 미설정\)/);
    assert.equal(list(ctx.db, 1, appA.id).length, 0);
  });

  it('generate with stubbed fetch creates AI rows and verifies header authentication', async () => {
    process.env.GEMINI_API_KEY = 'test-secret-api-key-999';
    let interceptedUrl = null;
    let interceptedHeaders = null;

    setFetchImpl(async (url, init) => {
      interceptedUrl = url;
      interceptedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(['AI 면접 질문 1', 'AI 면접 질문 2', 'AI 면접 질문 3']) }] } }],
        }),
      };
    });

    const genRes = await userA.agent.post(`/applications/${appA.id}/interview-questions/generate`).type('form').send({ _csrf: userA.csrfToken });
    assert.equal(genRes.status, 302);

    assert.equal(interceptedHeaders['x-goog-api-key'], 'test-secret-api-key-999');
    assert.equal(interceptedUrl.includes('test-secret-api-key-999'), false);
    assert.equal(interceptedUrl.includes('key='), false);

    const detailRes = await userA.agent.get(`/applications/${appA.id}`);
    assert.match(detailRes.text, /AI 면접 질문 1/);
    assert.match(detailRes.text, /AI 생성/);

    const rows = list(ctx.db, 1, appA.id);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.source === 'ai'));
  });

  it('stubbed fetch returning garbage creates no rows and reports error message', async () => {
    process.env.GEMINI_API_KEY = 'test-secret-api-key-999';
    const beforeCount = list(ctx.db, 1, appA.id).length;

    setFetchImpl(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'THIS IS NOT VALID JSON' }] } }] }),
    }));

    const genRes = await userA.agent.post(`/applications/${appA.id}/interview-questions/generate`).type('form').send({ _csrf: userA.csrfToken });
    assert.equal(genRes.status, 302);

    const detailRes = await userA.agent.get(`/applications/${appA.id}`);
    assert.match(detailRes.text, /AI 응답/);
    assert.equal(list(ctx.db, 1, appA.id).length, beforeCount);
  });

  it('rate limit triggers after maximum generations', async () => {
    process.env.GEMINI_API_KEY = 'test-secret-api-key-999';
    resetRateLimit();
    setFetchImpl(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(['질문 A', '질문 B']) }] } }],
      }),
    }));

    for (let i = 0; i < 5; i += 1) {
      const res = await userA.agent.post(`/applications/${appA.id}/interview-questions/generate`).type('form').send({ _csrf: userA.csrfToken });
      assert.equal(res.status, 302);
    }

    const limitedRes = await userA.agent.post(`/applications/${appA.id}/interview-questions/generate`).type('form').send({ _csrf: userA.csrfToken });
    assert.equal(limitedRes.status, 429);
    assert.match(limitedRes.text, /한도를 초과했습니다/);
  });
});
