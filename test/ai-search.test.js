const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const {
  setFetchImpl,
  resetRateLimit,
  checkRateLimit,
  getAiConfig,
  searchJobPostings,
  RATE_LIMIT_MAX,
} = require('../src/services/aiService');

const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_MODEL_SEARCH', 'OPENAI_MODEL_BRIEFING'];

const SAMPLE_RESULTS = [
  { company_name: '토스', title: 'Frontend Platform Engineer', position: 'Frontend', employment_type: 'experienced', deadline: '2099-12-15', url: 'https://toss.im/career/job-detail?job_id=123', location: '서울 강남구', summary: '디자인 시스템 개발' },
  { company_name: '가짜기업', title: '백엔드', position: 'Backend', employment_type: 'new_grad', deadline: '2099-12-01', url: 'javascript:alert(1)', location: '서울', summary: 'URL 무효' },
  { company_name: '출처없음', title: '데이터', position: 'Data', employment_type: 'new_grad', deadline: null, url: '', location: '', summary: 'URL 없음' },
  { company_name: '네이버', title: '2026 신입 공개채용', position: 'FE', employment_type: 'bogus', deadline: '2026-02-30', url: 'https://recruit.navercorp.com/rcrt/view.do?annoId=999', location: '성남', summary: '<img src=x onerror=alert(1)>' },
];

function stubResponse(payloadText, annotations = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'completed',
      output: [
        { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'q' } },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: payloadText, annotations }] },
      ],
    }),
  };
}

function installStub(text, annotations) {
  const calls = [];
  setFetchImpl(async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return stubResponse(text, annotations);
  });
  return calls;
}

describe('AI job search (C): service + /jobs/discover + /api/jobs/search', () => {
  let ctx, user;
  const envBackup = {};

  before(async () => {
    ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; });
    ctx = createTestContext();
    user = await signupAndLogin(ctx.app, { email: 'search_a@readysetjob.dev' });
  });

  beforeEach(() => {
    resetRateLimit();
    setFetchImpl(null);
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  after(() => {
    setFetchImpl(null);
    resetRateLimit();
    ENV_KEYS.forEach((k) => (envBackup[k] !== undefined ? (process.env[k] = envBackup[k]) : delete process.env[k]));
    ctx.cleanup();
  });

  it('lists search/briefing in getAiConfig and honors OPENAI_MODEL_SEARCH and global OPENAI_MODEL', () => {
    const cfg = getAiConfig();
    assert.equal(cfg.search, 'gpt-6.1-terra');
    assert.equal(cfg.briefing, 'gpt-6-luna');
    const search = cfg.features.find((f) => f.key === 'search');
    const briefing = cfg.features.find((f) => f.key === 'briefing');
    assert.equal(search.envVar, 'OPENAI_MODEL_SEARCH');
    assert.equal(search.effort, 'low');
    assert.equal(briefing.envVar, 'OPENAI_MODEL_BRIEFING');
    assert.equal(briefing.effort, 'low');
    process.env.OPENAI_MODEL_SEARCH = 'gpt-search-custom';
    assert.equal(getAiConfig().search, 'gpt-search-custom');
    process.env.OPENAI_MODEL = 'gpt-global-override';
    assert.equal(getAiConfig().search, 'gpt-global-override');
    assert.equal(getAiConfig().briefing, 'gpt-global-override');
  });

  it('service sends web_search tool request and drops results without a valid source URL', async () => {
    process.env.OPENAI_API_KEY = 'sk-search-service-test';
    const calls = installStub(JSON.stringify({ results: SAMPLE_RESULTS }), [
      { type: 'url_citation', url: 'https://toss.im/career/job-detail?job_id=123', title: 'Toss Careers' },
      { type: 'url_citation', url: 'ftp://bad.example', title: 'bad' },
    ]);
    const out = await searchJobPostings({ keyword: '프론트엔드', location: '서울', career: 'new_grad', extra: 'React' });
    const { url, headers, body } = calls[0];
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(headers.Authorization, 'Bearer sk-search-service-test');
    assert.equal(body.model, 'gpt-6.1-terra');
    assert.equal(body.reasoning.effort, 'low');
    assert.equal(body.tools[0].type, 'web_search');
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.text.format.type, 'json_schema');
    assert.match(body.input, /프론트엔드/);
    assert.deepEqual(out.results.map((r) => r.company_name), ['토스', '네이버']);
    assert.equal(out.results[0].deadline, '2099-12-15');
    assert.equal(out.results[1].deadline, null);
    assert.equal(out.results[1].employment_type, 'unknown');
    assert.deepEqual(out.citations, [{ url: 'https://toss.im/career/job-detail?job_id=123', title: 'Toss Careers' }]);
  });

  it('GET /jobs/discover renders the page (not swallowed by /jobs/:id) and requires login', async () => {
    const res = await user.agent.get('/jobs/discover');
    assert.equal(res.status, 200);
    assert.match(res.text, /AI 공고 찾기/);
    assert.match(res.text, /AI 웹 검색 결과는 오래되었거나 부정확할 수 있으니 출처에서 확인 후 등록하세요\./);
    assert.match(res.text, /OPENAI_API_KEY 미설정/);
    const anon = await require('supertest')(ctx.app).get('/jobs/discover');
    assert.equal(anon.status, 302);
    const listRes = await user.agent.get('/jobs');
    assert.match(listRes.text, /href="\/jobs\/discover"/);
  });

  it('returns 503 when disabled, 403 without CSRF, 422 on empty keyword — without calling OpenAI', async () => {
    const calls = installStub('{}');
    const disabled = await user.agent.post('/api/jobs/search').set('X-CSRF-Token', user.csrfToken).send({ keyword: '백엔드' });
    assert.equal(disabled.status, 503);
    assert.match(disabled.body.error, /OPENAI_API_KEY 미설정/);

    process.env.OPENAI_API_KEY = 'sk-test';
    assert.equal((await user.agent.post('/api/jobs/search').send({ keyword: '백엔드' })).status, 403);
    const empty = await user.agent.post('/api/jobs/search').set('X-CSRF-Token', user.csrfToken).send({ keyword: '   ' });
    assert.equal(empty.status, 422);
    assert.equal(calls.length, 0);
  });

  it('POST /api/jobs/search returns decorated, validated results and saves nothing', async () => {
    process.env.OPENAI_API_KEY = 'sk-route-test';
    installStub(JSON.stringify({ results: SAMPLE_RESULTS }));
    const before = ctx.db.prepare('SELECT COUNT(*) AS c FROM job_posts').get().c;
    const res = await user.agent.post('/api/jobs/search').set('X-CSRF-Token', user.csrfToken)
      .send({ keyword: '프론트엔드', career: 'hacker' });
    assert.equal(res.status, 200);
    assert.equal(res.body.results.length, 2);
    const [toss, naver] = res.body.results;
    assert.match(toss.avatar.className, /^avatar--[0-7]$/);
    assert.equal(toss.register_employment_type, 'experienced');
    assert.equal(naver.register_employment_type, 'other');
    assert.equal(naver.dday.state, 'none');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM job_posts').get().c, before);
  });

  it('no-JS form POST renders escaped results with source link and a working register form', async () => {
    process.env.OPENAI_API_KEY = 'sk-form-test';
    installStub('```json\n' + JSON.stringify({ results: SAMPLE_RESULTS }) + '\n```');
    const res = await user.agent.post('/jobs/discover').type('form').send({ _csrf: user.csrfToken, keyword: '프론트엔드' });
    assert.equal(res.status, 200);
    assert.match(res.text, /href="https:\/\/toss\.im\/career\/job-detail\?job_id=123" target="_blank" rel="noopener noreferrer"/);
    assert.equal(res.text.includes('<img src=x'), false);
    assert.equal(res.text.includes('javascript:alert'), false);
    assert.match(res.text, /name="new_company_name" value="토스"/);

    const reg = await user.agent.post('/jobs').type('form').send({
      _csrf: user.csrfToken, new_company_name: '토스', title: 'Frontend Platform Engineer', position: 'Frontend',
      employment_type: 'other', deadline: '2099-12-15', url: 'https://toss.im/career/job-detail?job_id=123', memo: '요약',
    });
    assert.equal(reg.status, 302);
  });

  it('returns 502 on non-JSON model output and 429 when the shared AI rate limit is exhausted', async () => {
    process.env.OPENAI_API_KEY = 'sk-bad-output';
    installStub('검색 결과를 찾지 못했습니다.');
    const bad = await user.agent.post('/api/jobs/search').set('X-CSRF-Token', user.csrfToken).send({ keyword: '마케팅' });
    assert.equal(bad.status, 502);

    resetRateLimit();
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) checkRateLimit(1);
    const limited = await user.agent.post('/api/jobs/search').set('X-CSRF-Token', user.csrfToken).send({ keyword: '마케팅' });
    assert.equal(limited.status, 429);
  });
});
