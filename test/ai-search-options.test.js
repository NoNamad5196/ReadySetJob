const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { setFetchImpl, resetRateLimit } = require('../src/services/aiService');
const { buildJobSearchPrompt } = require('../src/services/aiSchemas');

function stubSuccess(results) {
  const calls = [];
  setFetchImpl(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        output: [
          { type: 'web_search_call', id: 'ws_1', status: 'completed' },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: JSON.stringify({ results }) }],
          },
        ],
      }),
    };
  });
  return calls;
}

describe('AI job search options: whitelist validation, purpose prompts, parttime & grad_school mapping', () => {
  let ctx, user;
  let savedKey;

  before(async () => {
    savedKey = process.env.OPENAI_API_KEY;
    ctx = createTestContext();
    user = await signupAndLogin(ctx.app, { email: 'search_opts@readysetjob.dev' });
  });

  beforeEach(() => {
    resetRateLimit();
    setFetchImpl(null);
    process.env.OPENAI_API_KEY = 'sk-options-test';
  });

  after(() => {
    setFetchImpl(null);
    resetRateLimit();
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
    ctx.cleanup();
  });

  it('rejects invalid purpose, empty/>3/mismatched fields, invalid region/degree/schedule, and >40 char keyword with 422', async () => {
    const calls = stubSuccess([]);
    const post = (payload) =>
      user.agent.post('/api/jobs/search').set('X-CSRF-Token', user.csrfToken).send(payload);

    const badCases = [
      { purpose: 'freelance', fields: ['프론트엔드'], region: '서울' },
      { purpose: '', fields: ['프론트엔드'], region: '서울' },
      { purpose: 'new_grad', fields: [], region: '서울' },
      { purpose: 'new_grad', fields: ['프론트엔드', '백엔드', '게임', '마케팅'], region: '서울' },
      { purpose: 'parttime', fields: ['프론트엔드'], region: '서울' },
      { purpose: 'grad_school', fields: ['카페·음료'], region: '서울' },
      { purpose: 'new_grad', fields: ['프론트엔드'], region: '제주도' },
      { purpose: 'grad_school', fields: ['AI·데이터사이언스'], region: '서울', degree: '학사' },
      { purpose: 'parttime', fields: ['카페·음료'], region: '서울', schedule: '야간전담' },
      { purpose: 'new_grad', fields: ['프론트엔드'], region: '서울', keyword: '가'.repeat(41) },
      { keyword: 'React', location: '서울', career: 'new_grad', extra: '' },
    ];

    for (const payload of badCases) {
      const res = await post(payload);
      assert.equal(res.status, 422, `Expected 422 for payload: ${JSON.stringify(payload)}`);
      assert.equal(typeof res.body.error, 'string');
      assert.ok(res.body.error.length > 0);
    }
    const formRes = await user.agent.post('/jobs/discover').type('form').send({
      _csrf: user.csrfToken, purpose: 'parttime', fields: '프론트엔드', region: '부산', schedule: '주말',
    });
    assert.equal(formRes.status, 422);
    assert.match(formRes.text, /허용되지 않은 분야/);
    assert.match(formRes.text, /name="purpose"[^>]*value="parttime"[^>]*checked/);
    assert.match(formRes.text, /name="region"[^>]*value="부산"[^>]*checked/);
    assert.equal(calls.length, 0);
  });

  it('builds purpose-specific prompts with preferred source hints for intern, parttime, and grad_school', () => {
    const internPrompt = buildJobSearchPrompt({
      purpose: 'intern',
      fields: ['백엔드', '데이터·AI'],
      region: '서울',
      keyword: '핀테크',
      today: '2026-11-12',
    });
    assert.match(internPrompt.instructions, /기업 공식 채용 페이지/);
    assert.match(internPrompt.instructions, /원티드/);
    assert.match(internPrompt.instructions, /사람인/);
    assert.match(internPrompt.instructions, /잡코리아/);
    assert.match(internPrompt.instructions, /잡플래닛/);
    assert.match(internPrompt.instructions, /링커리어/);
    assert.match(internPrompt.input, /백엔드, 데이터·AI/);

    const parttimePrompt = buildJobSearchPrompt({
      purpose: 'parttime',
      fields: ['카페·음료', '교내 근로'],
      region: '부산',
      schedule: '주말',
      today: '2026-11-12',
    });
    assert.match(parttimePrompt.instructions, /알바몬/);
    assert.match(parttimePrompt.instructions, /알바천국/);
    assert.match(parttimePrompt.instructions, /학교 근로장학 공지/);
    assert.match(parttimePrompt.input, /\[근무 형태\] 주말/);

    const gradPrompt = buildJobSearchPrompt({
      purpose: 'grad_school',
      fields: ['컴퓨터공학·소프트웨어', 'AI·데이터사이언스'],
      region: '대전',
      degree: '석박통합',
      today: '2026-11-12',
    });
    assert.match(gradPrompt.instructions, /각 대학원 입학처 모집요강/);
    assert.match(gradPrompt.instructions, /대학원 신입생 모집 공지/);
    assert.match(gradPrompt.input, /\[학위 과정\] 석박통합/);
  });

  it('maps parttime and grad_school results to employment_type="other", prefixes memo, adapts grad_school labels, and registers job post', async () => {
    stubSuccess([
      {
        company_name: '스타벅스 강남점',
        title: '주말 바리스타 채용',
        position: '바리스타',
        employment_type: 'intern',
        deadline: '2099-11-30',
        url: 'https://www.albamon.com/jobs/detail/111',
        location: '서울 강남구',
        summary: '주말 오전 근무 가능자 우대',
      },
    ]);

    const ptRes = await user.agent
      .post('/api/jobs/search')
      .set('X-CSRF-Token', user.csrfToken)
      .send({ purpose: 'parttime', fields: ['카페·음료'], region: '서울', schedule: '주말' });

    assert.equal(ptRes.status, 200);
    assert.equal(ptRes.body.results.length, 1);
    const ptItem = ptRes.body.results[0];
    assert.equal(ptItem.employment_type, 'other');
    assert.equal(ptItem.register_employment_type, 'other');
    assert.match(ptItem.register_memo, /^\[아르바이트\]/);

    stubSuccess([
      {
        company_name: '서울대학교 일반대학원',
        title: '2027학년도 전기 신입생 모집',
        position: '컴퓨터공학부 (석사·박사)',
        employment_type: 'new_grad',
        deadline: '2099-10-15',
        url: 'https://admission.snu.ac.kr/graduate/2027',
        location: '서울 관악구',
        summary: '전기 대학원 석사 및 석박통합과정 신입생 모집요강',
      },
    ]);

    const gradFormRes = await user.agent.post('/jobs/discover').type('form').send({
      _csrf: user.csrfToken,
      purpose: 'grad_school',
      fields: ['컴퓨터공학·소프트웨어'],
      region: '서울',
      degree: '석사',
    });
    assert.equal(gradFormRes.status, 200);
    assert.match(gradFormRes.text, /학교\/프로그램/);
    assert.match(gradFormRes.text, /2099-10-15 원서 마감/);
    assert.match(gradFormRes.text, /\[대학원\]/);

    const regRes = await user.agent.post('/jobs').type('form').send({
      _csrf: user.csrfToken,
      new_company_name: '서울대학교 일반대학원',
      title: '2027학년도 전기 신입생 모집',
      position: '컴퓨터공학부 (석사·박사)',
      employment_type: 'other',
      deadline: '2099-10-15',
      url: 'https://admission.snu.ac.kr/graduate/2027',
      memo: '[대학원] 전기 대학원 석사 및 석박통합과정 신입생 모집요강',
    });
    assert.equal(regRes.status, 302);
    const savedJob = ctx.db
      .prepare('SELECT j.*, c.name AS company_name FROM job_posts j JOIN companies c ON c.id = j.company_id WHERE j.title = ?')
      .get('2027학년도 전기 신입생 모집');
    assert.equal(savedJob.company_name, '서울대학교 일반대학원');
    assert.equal(savedJob.employment_type, 'other');
    assert.match(savedJob.memo, /^\[대학원\]/);
  });
});
