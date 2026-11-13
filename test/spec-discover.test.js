const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, signupAndLogin, extractCsrfToken } = require('./helpers');
const qnet = require('../src/services/specSources/qnet');
const alio = require('../src/services/specSources/alio');
const { resetRateLimit, checkRateLimit, RATE_LIMIT_MAX } = require('../src/services/aiService');

const NEXT_YEAR = String(new Date().getFullYear() + 1);
const ENV = ['DATA_GO_KR_SERVICE_KEY', 'WORK24_AUTH_KEY', 'DATAQ_API_URL', 'OPENAI_API_KEY'];
const ROW = {
  implYy: NEXT_YEAR, implSeq: '2', qualgbCd: 'T', description: '<img src=x onerror=alert(1)>',
  docRegStartDt: '20990414', docRegEndDt: '20990417', docExamStartDt: '20990509', docExamEndDt: '20990520', docPassDt: '20990611',
  pracRegStartDt: '20990622', pracRegEndDt: '20990625', pracExamStartDt: '20990719', pracExamEndDt: '20990806', pracPassDt: '20990910',
};
const qnetJson = () => new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: [ROW] } } } }), { headers: { 'content-type': 'application/json' } });
const CERT_SEARCH = { kind: 'certificate', cert_code: '1320', year: NEXT_YEAR };

describe('/specs/discover routes', () => {
  let ctx;
  let user;
  const backup = {};
  let fetchCalls = 0;

  before(async () => {
    ENV.forEach((k) => { backup[k] = process.env[k]; });
    ctx = createTestContext();
    user = await signupAndLogin(ctx.app, { email: 'spec_discover@readysetjob.dev' });
  });
  beforeEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    fetchCalls = 0;
    resetRateLimit();
    ctx.db.prepare('DELETE FROM external_cache').run();
    qnet.setFetchImpl(async () => { fetchCalls += 1; return qnetJson(); });
  });
  after(() => {
    qnet.setFetchImpl(null);
    alio.setFetchImpl(null);
    resetRateLimit();
    ENV.forEach((k) => (backup[k] === undefined ? delete process.env[k] : (process.env[k] = backup[k])));
    ctx.cleanup();
  });

  const api = (body, token = user.csrfToken) => user.agent.post('/api/specs/discover').set('X-CSRF-Token', token).send(body);

  it('requires login for the page and the JSON API', async () => {
    const anon = request.agent(ctx.app);
    assert.equal((await anon.get('/specs/discover')).status, 302);
    const csrf = extractCsrfToken((await anon.get('/login')).text);
    const res = await anon.post('/api/specs/discover').set('X-CSRF-Token', csrf).send(CERT_SEARCH);
    assert.equal(res.status, 401);
  });

  it('renders all kind chips, catalog fallback and disabled-source notes without inline styles or a verify disclaimer', async () => {
    const res = await user.agent.get('/specs/discover');
    assert.equal(res.status, 200);
    for (const kind of ['certificate', 'bootcamp', 'contest', 'activity', 'grad_school', 'private_certificate', 'public_job']) {
      assert.match(res.text, new RegExp(`name="kind" value="${kind}"`));
    }
    assert.match(res.text, /<option value="1320"[^>]*>정보처리기사/);
    assert.match(res.text, /고용24 오픈API 인증키 필요\(기업회원 심사\)/);
    assert.match(res.text, /<link rel="stylesheet" href="\/css\/spec-discover.css">/);
    assert.match(res.text, /<script src="\/js\/spec-discover.js" defer><\/script>/);
    assert.equal(/style="|onclick=|확인 후 등록/.test(res.text), false);
  });

  it('rejects missing CSRF tokens on search, register and watch', async () => {
    assert.equal((await user.agent.post('/api/specs/discover').send(CERT_SEARCH)).status, 403);
    assert.equal((await user.agent.post('/specs/discover').type('form').send(CERT_SEARCH)).status, 403);
    assert.equal((await user.agent.post('/specs/discover/register').type('form').send({ token: 'a'.repeat(24) })).status, 403);
    assert.equal((await user.agent.post('/specs/discover/watch').type('form').send({ cert_code: '1320' })).status, 403);
  });

  it('returns Korean 422 errors for non-whitelisted input without touching the network', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = 'k';
    const cases = [
      [{ kind: 'hacking' }, /스펙 종류/],
      [{ kind: 'contest', fields: ['우주여행'] }, /분야/],
      [{ kind: 'contest', fields: ['IT·SW', '디자인', '창업', '봉사'] }, /최대 3개/],
      [{ kind: 'contest', fields: [] }, /1개 이상/],
      [{ kind: 'bootcamp', region: '99' }, /지역/],
      [{ kind: 'certificate', cert_code: '1320', year: '1990' }, /연도/],
      [{ kind: 'contest', fields: ['IT·SW'], keyword: 'x'.repeat(41) }, /40자/],
      [{ kind: 'contest', fields: ['IT·SW'], source: 'qnet' }, /데이터 소스/],
      [{ kind: { $ne: 1 } }, /형식/],
    ];
    for (const [body, pattern] of cases) {
      const res = await api(body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.match(res.body.error, pattern);
    }
    const form = await user.agent.post('/specs/discover').type('form').send({ _csrf: user.csrfToken, kind: 'grad_school', grad_fields: '경영·경제', degree: '학사' });
    assert.equal(form.status, 422);
    assert.match(form.text, /학위를 올바르게 선택해 주세요/);
    assert.equal(fetchCalls, 0);
  });

  it('JSON search returns decorated official items; disabled source yields a notice instead of an error', async () => {
    const off = await api(CERT_SEARCH);
    assert.equal(off.status, 200);
    assert.deepEqual(off.body.items, []);
    assert.match(off.body.notices[0].message, /DATA_GO_KR_SERVICE_KEY/);

    process.env.DATA_GO_KR_SERVICE_KEY = 'k';
    const res = await api(CERT_SEARCH);
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 2);
    const [doc] = res.body.items;
    assert.equal(doc.source_label, '공식 데이터: Q-Net');
    assert.equal(doc.kind_label, '자격증');
    assert.equal(doc.can_watch, true);
    assert.match(doc.token, /^[a-f0-9]{24}$/);
    assert.match(doc.avatar.className, /^avatar--[0-7]$/);
    assert.equal(doc.dday.state, 'upcoming');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM spec_items').get().c, 0, 'searching never saves');
  });

  it('no-JS search renders escaped cards; register creates the spec with automation and flags duplicates', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = 'k';
    const page = await user.agent.post('/specs/discover').type('form').send({ _csrf: user.csrfToken, ...CERT_SEARCH, mode: 'search' });
    assert.equal(page.status, 200);
    assert.ok(page.text.includes(`정보처리기사 ${NEXT_YEAR}년 제2회 필기`));
    assert.match(page.text, /공식 데이터: Q-Net/);
    assert.match(page.text, /관심 자격증 구독/);
    assert.equal(page.text.includes('<img src=x'), false);
    const token = page.text.match(/name="token" value="([a-f0-9]{24})"/)[1];

    const first = await user.agent.post('/specs/discover/register').type('form').send({ _csrf: user.csrfToken, token, title: 'forged', source: 'manual' });
    assert.equal(first.status, 302);
    const id = Number(first.headers.location.split('/').pop());
    const row = ctx.db.prepare('SELECT * FROM spec_items WHERE id = ?').get(id);
    assert.equal(row.title, `정보처리기사 ${NEXT_YEAR}년 제2회 필기`, 'client-supplied fields are ignored');
    assert.equal(row.source, 'qnet');
    assert.equal(row.apply_end, '2099-04-17');
    assert.ok(ctx.db.prepare('SELECT COUNT(*) AS c FROM events WHERE spec_item_id = ?').get(id).c >= 3);
    assert.match((await user.agent.get(first.headers.location)).text, /스펙에 등록했습니다\. 일정과 할 일이 자동으로 추가되었습니다\./);

    const dup = await user.agent.post('/specs/discover/register').type('form').send({ _csrf: user.csrfToken, token });
    assert.equal(dup.headers.location, `/specs/${id}`);
    assert.match((await user.agent.get(dup.headers.location)).text, /이미 등록된 스펙입니다/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM spec_items WHERE source_ref = ?').get(`1320-${NEXT_YEAR}-2-doc`).c, 1);

    const forged = await user.agent.post('/specs/discover/register').type('form').send({ _csrf: user.csrfToken, token: 'f'.repeat(24) });
    assert.equal(forged.status, 422);
  });

  it('another user cannot reuse a result token', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = 'k';
    const token = (await api(CERT_SEARCH)).body.items[1].token;
    const other = await signupAndLogin(ctx.app, { email: 'spec_discover_b@readysetjob.dev' });
    const res = await other.agent.post('/specs/discover/register').type('form').send({ _csrf: other.csrfToken, token });
    assert.equal(res.status, 422);
  });

  it('subscribes to a catalog certificate once and rejects unknown codes', async () => {
    const ok = await user.agent.post('/specs/discover/watch').type('form').send({ _csrf: user.csrfToken, cert_code: '1320' });
    assert.equal(ok.status, 302);
    assert.match((await user.agent.get('/specs/discover')).text, /정보처리기사을\(를\) 관심 자격증으로 구독했습니다/);
    const again = await user.agent.post('/specs/discover/watch').type('form').send({ _csrf: user.csrfToken, cert_code: '1320' });
    assert.equal(again.status, 302);
    assert.match((await user.agent.get('/specs/discover')).text, /이미 정보처리기사을\(를\) 구독하고 있습니다/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM spec_watch WHERE cert_code = ?').get('1320').c, 1);
    const bad = await user.agent.post('/specs/discover/watch').type('form').send({ _csrf: user.csrfToken, cert_code: '8888' });
    assert.equal(bad.status, 422);
  });

  it('ALIO jobs are offered as job postings, not spec registration', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = 'k';
    alio.setFetchImpl(async () => new Response(JSON.stringify({ result: [{ recrutPblntSn: '9', recrutPbancTtl: '2099 신입 채용', instNm: '한국전력공사', pbancEndYmd: '20991130' }] }), { headers: { 'content-type': 'application/json' } }));
    const res = await api({ kind: 'public_job', keyword: '신입' });
    assert.equal(res.body.items[0].is_job, true);
    const reg = await user.agent.post('/specs/discover/register').type('form').send({ _csrf: user.csrfToken, token: res.body.items[0].token });
    assert.equal(reg.status, 422);
  });

  it('AI-backed kinds hit the shared AI rate limit with 429', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const uid = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get('spec_discover@readysetjob.dev').id;
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) checkRateLimit(uid);
    const res = await api({ kind: 'grad_school', fields: ['AI·데이터사이언스'], degree: '석사' });
    assert.equal(res.status, 429);
    assert.match(res.body.error, /AI 기능 요청 한도/);
  });
});
