const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { createJobPostWithCompany } = require('../src/services/jobsService');
const { createApplication } = require('../src/services/applicationsService');
const { createEssay } = require('../src/services/essaysService');
const { createMaterial, getMaterialById } = require('../src/services/materialsService');
const { setFetchImpl, resetRateLimit } = require('../src/services/aiService');

describe('OpenAI Responses API Features (Feedback, STAR Draft, Job Parse, Settings)', () => {
  let ctx, userA, userB, essayA, questionA, matA;
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
    ENV_KEYS.forEach((k) => {
      envBackup[k] = process.env[k];
      delete process.env[k];
    });
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'ai_a@readysetjob.dev', password: 'password123!', name: '사용자A' });
    userB = await signupAndLogin(ctx.app, { email: 'ai_b@readysetjob.dev', password: 'password123!', name: '사용자B' });

    const jobA = createJobPostWithCompany(ctx.db, 1, { new_company_name: '네이버', title: 'FE 공채', position: 'Frontend' });
    const appA = createApplication(ctx.db, 1, { job_post_id: jobA.id, stage: 'document' });
    essayA = createEssay(ctx.db, 1, {
      title: '네이버 자소서',
      application_id: appA.id,
      questions: [{ question: '지원 동기와 기술 역량을 작성하세요.', char_limit: 800, answer: '웹 성능 최적화 프로젝트를 수행했습니다.' }],
    });
    questionA = essayA.questions[0];
    matA = createMaterial(ctx.db, 1, {
      kind: 'project',
      title: '대규모 트래픽 캐싱 개선',
      period: '2026.03 - 2026.06',
      content: 'SQLite WAL 모드와 인덱스 튜닝으로 조회 지연을 줄였습니다.',
      tags: 'SQLite,성능',
    });
  });

  beforeEach(() => {
    resetRateLimit();
    setFetchImpl(null);
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  after(() => {
    setFetchImpl(null);
    resetRateLimit();
    ENV_KEYS.forEach((k) => {
      if (envBackup[k] !== undefined) process.env[k] = envBackup[k];
      else delete process.env[k];
    });
    ctx.cleanup();
  });

  it('returns 503 with Korean disabled message and inserts no rows when OPENAI_API_KEY is unset', async () => {
    const fbRes = await userA.agent
      .post(`/api/essays/${essayA.id}/questions/${questionA.id}/feedback`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({});
    assert.equal(fbRes.status, 503);
    assert.match(fbRes.body.error, /지금은 사용할 수 없습니다/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS cnt FROM essay_feedback').get().cnt, 0);

    const starJsonRes = await userA.agent
      .post(`/api/materials/${matA.id}/star-draft`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({});
    assert.equal(starJsonRes.status, 503);
    assert.match(starJsonRes.body.error, /지금은 사용할 수 없습니다/);

    const starFormRes = await userA.agent
      .post(`/materials/${matA.id}/star-draft`)
      .type('form')
      .send({ _csrf: userA.csrfToken });
    assert.equal(starFormRes.status, 302);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS cnt FROM material_star_drafts').get().cnt, 0);

    const parseRes = await userA.agent
      .post('/api/jobs/parse')
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ text: '토스 프론트엔드 개발자 채용 마감 2026-12-01' });
    assert.equal(parseRes.status, 503);
    assert.match(parseRes.body.error, /지금은 사용할 수 없습니다/);
  });

  it('enforces CSRF (403) and ownership (404) across AI endpoints', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-secret-key';

    assert.equal((await userA.agent.post(`/api/essays/${essayA.id}/questions/${questionA.id}/feedback`).send({})).status, 403);
    assert.equal((await userA.agent.post(`/api/materials/${matA.id}/star-draft`).send({})).status, 403);
    assert.equal((await userA.agent.post('/api/jobs/parse').send({ text: '공고' })).status, 403);

    assert.equal(
      (await userB.agent.post(`/api/essays/${essayA.id}/questions/${questionA.id}/feedback`).set('X-CSRF-Token', userB.csrfToken).send({})).status,
      404
    );
    assert.equal(
      (await userB.agent.get(`/api/essays/${essayA.id}/questions/${questionA.id}/feedback`)).status,
      404
    );
    assert.equal(
      (await userB.agent.post(`/api/materials/${matA.id}/star-draft`).set('X-CSRF-Token', userB.csrfToken).send({})).status,
      404
    );
    assert.equal(
      (await userB.agent.post(`/materials/${matA.id}/star-draft/999/apply`).type('form').send({ _csrf: userB.csrfToken })).status,
      404
    );
  });

  it('generates and retrieves essay feedback, verifying OpenAI request shape and body.answer override', async () => {
    process.env.OPENAI_API_KEY = 'sk-feedback-secret';
    let capturedCall = null;
    const validFeedback = {
      summary: '문제 해결 과정이 명확하나 정량적 성과 보완이 필요합니다.',
      scores: { specificity: 4, relevance: 5, structure: 4, length_fit: 3 },
      strengths: ['직무 연관성이 높음', '문제 원인 분석이 구체적임'],
      improvements: [{ issue: '정량 수치 부족', suggestion: '응답 시간 단축 비율을 명시하세요.', quote: '조회 지연을 줄였습니다.' }],
      length_note: '권장 분량 대비 다소 짧으므로 협업 사례를 보강하세요.',
    };

    setFetchImpl(async (url, init) => {
      capturedCall = { url, headers: init.headers, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validFeedback) }] }],
        }),
      };
    });

    const postRes = await userA.agent
      .post(`/api/essays/${essayA.id}/questions/${questionA.id}/feedback`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ answer: '오버라이드된 초안 답변입니다.' });
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.summary, validFeedback.summary);
    assert.equal(postRes.body.scores.relevance, 5);

    assert.equal(capturedCall.url, 'https://api.openai.com/v1/responses');
    assert.equal(capturedCall.headers.Authorization, 'Bearer sk-feedback-secret');
    assert.equal(capturedCall.url.includes('sk-feedback-secret'), false);
    assert.equal(capturedCall.body.model, 'gpt-6.1-terra');
    assert.equal(capturedCall.body.reasoning.effort, 'medium');
    assert.equal(capturedCall.body.text.format.type, 'json_schema');
    assert.equal(capturedCall.body.text.format.name, 'essay_feedback');
    assert.equal(capturedCall.body.text.format.strict, true);
    assert.match(capturedCall.body.input, /오버라이드된 초안 답변입니다\./);

    const getRes = await userA.agent.get(`/api/essays/${essayA.id}/questions/${questionA.id}/feedback`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.feedback.summary, validFeedback.summary);
  });

  it('generates STAR draft and appends formatted STAR block on apply', async () => {
    process.env.OPENAI_API_KEY = 'sk-star-secret';
    let capturedBody = null;
    const starOutput = {
      situation: '트래픽 급증 시 SQLite 단일 파일 잠금으로 조회 지연 발생',
      task: '외부 DB 도입 없이 응답 속도와 동시성을 개선',
      action: 'WAL 모드 활성화 및 복합 인덱스 설계',
      result: '쿼리 지연 현상 해소 및 안정적인 동시 읽기 처리 달성',
      one_liner: 'SQLite WAL 및 인덱스 튜닝으로 조회 성능을 개선한 프로젝트',
      missing_info: ['개선 전후 평균 응답 시간(ms) 수치', '동시 접속자 또는 요청 건수 규모'],
    };

    setFetchImpl(async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', output_text: JSON.stringify(starOutput) }),
      };
    });

    const draftRes = await userA.agent
      .post(`/api/materials/${matA.id}/star-draft`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({});
    assert.equal(draftRes.status, 200);
    assert.equal(capturedBody.model, 'gpt-6.1-terra');
    assert.equal(capturedBody.reasoning.effort, 'low');
    assert.equal(draftRes.body.draft.one_liner, starOutput.one_liner);
    assert.equal(draftRes.body.draft.missing_info.length, 2);

    const applyRes = await userA.agent
      .post(`/materials/${matA.id}/star-draft/${draftRes.body.draft.id}/apply`)
      .type('form')
      .send({ _csrf: userA.csrfToken });
    assert.equal(applyRes.status, 302);

    const updatedMat = getMaterialById(ctx.db, 1, matA.id);
    assert.match(updatedMat.content, /\[STAR 초안 요약\] SQLite WAL 및 인덱스 튜닝으로 조회 성능을 개선한 프로젝트/);
    assert.match(updatedMat.content, /- 보완 필요 정보: 개선 전후 평균 응답 시간\(ms\) 수치/);
  });

  it('parses job posting text with gpt-6-luna and drops invalid date, url, and enum values without saving to DB', async () => {
    process.env.OPENAI_API_KEY = 'sk-parse-secret';
    let capturedBody = null;
    const beforeJobs = ctx.db.prepare('SELECT COUNT(*) AS cnt FROM job_posts').get().cnt;

    setFetchImpl(async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          output_text: JSON.stringify({
            company_name: '당근',
            title: '프론트엔드 엔지니어 채용',
            position: 'Frontend Engineer',
            employment_type: 'contract',
            deadline: '2026-02-30',
            url: 'javascript:alert(1)',
            memo: 'React 및 웹 표준 기반 서비스 개발',
            essay_questions: [{ question: '가장 도전적이었던 기술적 문제를 설명해 주세요.', char_limit: 1000 }],
          }),
        }),
      };
    });

    const res = await userA.agent
      .post('/api/jobs/parse')
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ text: '당근 프론트엔드 엔지니어 채용 공고 본문 텍스트' });
    assert.equal(res.status, 200);
    assert.equal(capturedBody.model, 'gpt-6-luna');
    assert.equal(capturedBody.reasoning.effort, 'none');
    assert.equal(res.body.company_name, '당근');
    assert.equal(res.body.employment_type, null);
    assert.equal(res.body.deadline, null);
    assert.equal(res.body.url, null);
    assert.equal(res.body.essay_questions.length, 1);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS cnt FROM job_posts').get().cnt, beforeJobs);
  });

});
