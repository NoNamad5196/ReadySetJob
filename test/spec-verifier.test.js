const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const verifier = require('../src/services/specSources/verifier');
const aiVerified = require('../src/services/specSources/aiVerified');
const { resetRateLimit, checkRateLimit, RATE_LIMIT_MAX } = require('../src/services/aiService');

const { verifyCandidate, dateAppearsInText, titleKeywordsOverlap, isPrivateOrReservedIp, isHostAllowed, extractVisibleText } = verifier;
const PUBLIC_IP = [{ address: '203.0.114.10', family: 4 }];
const publicLookup = async () => PUBLIC_IP;
const PAGE = '<html><head><style>.x{}</style><script>var d="2026.11.30";</script></head><body><h1>2026 청년 데이터 분석 공모전</h1><p>접수 마감: 2026. 11. 30.(월) 18:00</p></body></html>';
const CANDIDATE = { title: '청년 데이터 분석 공모전', source_url: 'https://www.contest.go.kr/notice/1', apply_end: '2026-11-30' };
const html = (body, headers = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (location) => new Response(null, { status: 302, headers: { location } });

function sequence(...responses) {
  const calls = [];
  const fn = async (url) => { calls.push(url); return responses.shift(); };
  fn.calls = calls;
  return fn;
}

describe('spec verifier: SSRF guards and evidence matching', () => {
  it('classifies private, loopback, link-local, CGNAT, metadata and mapped IPv6 addresses as blocked', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '100.64.0.1', '172.16.5.4', '192.168.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'not-an-ip']) {
      assert.equal(isPrivateOrReservedIp(ip), true, ip);
    }
    for (const ip of ['203.0.114.10', '211.43.1.5', '2404:6800:4004:80c::200e']) assert.equal(isPrivateOrReservedIp(ip), false, ip);
  });

  it('applies the per-kind host allowlist and blocks aggregators', () => {
    assert.equal(isHostAllowed('gradschool.snu.ac.kr', 'grad_school'), true);
    assert.equal(isHostAllowed('www.contest.go.kr', 'grad_school'), false);
    assert.equal(isHostAllowed('exam.toeic.co.kr', 'private_cert'), true);
    assert.equal(isHostAllowed('www.opic.or.kr', 'private_cert'), true);
    assert.equal(isHostAllowed('toeic.co.kr.evil.com', 'private_cert'), false);
    assert.equal(isHostAllowed('www.kisa.or.kr', 'contest'), true);
    assert.equal(isHostAllowed('www.example.com', 'contest'), false);
    assert.equal(isHostAllowed('www.work.go.kr', 'contest'), false, 'aggregators stay blocked even on public suffixes');
    assert.equal(isHostAllowed('203.0.114.10', 'contest'), false);
  });

  it('verifies a page when title keywords and the key date both appear in visible text', async () => {
    const fetchImpl = sequence(html(PAGE));
    const outcome = await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl, dnsLookupImpl: publicLookup });
    assert.equal(outcome.verified, true);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(extractVisibleText(PAGE).includes('var d'), false);
  });

  it('rejects private DNS answers before any request is sent', async () => {
    const fetchImpl = sequence(html(PAGE));
    const mixed = async () => [...PUBLIC_IP, { address: '10.0.0.8', family: 4 }];
    const outcome = await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl, dnsLookupImpl: mixed });
    assert.equal(outcome.verified, false);
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('re-checks every redirect hop: private target, non-allowlisted host, and more than 2 hops are rejected', async () => {
    const lookup = async (host) => (host === 'internal.contest.go.kr' ? [{ address: '169.254.169.254', family: 4 }] : PUBLIC_IP);
    const toPrivate = sequence(redirect('https://internal.contest.go.kr/latest'), html(PAGE));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: toPrivate, dnsLookupImpl: lookup })).verified, false);
    assert.equal(toPrivate.calls.length, 1);

    const offList = sequence(redirect('https://blog.example.com/post'));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: offList, dnsLookupImpl: publicLookup })).reason, 'redirect_not_allowed');
    const withPort = sequence(redirect('https://www.contest.go.kr:8443/x'));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: withPort, dnsLookupImpl: publicLookup })).reason, 'redirect_not_allowed');

    const hops = sequence(redirect('/a'), redirect('/b'), redirect('/c'), html(PAGE));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: hops, dnsLookupImpl: publicLookup })).reason, 'too_many_redirects');
    assert.equal(hops.calls.length, 3);

    const twoHops = sequence(redirect('/a'), redirect('/b'), html(PAGE));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: twoHops, dnsLookupImpl: publicLookup })).verified, true);
  });

  it('rejects credentials, ports, non-http schemes, oversized bodies, non-HTML and slow pages', async () => {
    for (const url of ['https://user:pw@www.contest.go.kr/', 'https://www.contest.go.kr:8080/', 'ftp://www.contest.go.kr/', 'http://127.0.0.1/']) {
      assert.equal((await verifyCandidate({ ...CANDIDATE, source_url: url }, { kind: 'contest', fetchImpl: sequence(html(PAGE)), dnsLookupImpl: publicLookup })).reason, 'host_not_allowed', url);
    }
    const big = sequence(html(new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode('a'.repeat(256 * 1024))); } })));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: big, dnsLookupImpl: publicLookup })).reason, 'too_large');
    const declared = sequence(html('x', { 'content-length': String(5 * 1024 * 1024) }));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: declared, dnsLookupImpl: publicLookup })).reason, 'too_large');
    const pdf = sequence(new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: pdf, dnsLookupImpl: publicLookup })).reason, 'content_type_rejected');
    const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    assert.equal((await verifyCandidate(CANDIDATE, { kind: 'contest', fetchImpl: hang, dnsLookupImpl: publicLookup, timeoutMs: 30 })).reason, 'timeout');
  });

  it('default transport pins connections to vetted addresses (rebinding to loopback is refused)', async () => {
    let calls = 0;
    const rebinding = async () => { calls += 1; return calls === 1 ? PUBLIC_IP : [{ address: '127.0.0.1', family: 4 }]; };
    const outcome = await verifyCandidate({ ...CANDIDATE, source_url: 'http://rebind.invalid-test.go.kr/' }, { kind: 'contest', dnsLookupImpl: rebinding, timeoutMs: 2000 });
    assert.equal(outcome.verified, false);
    assert.ok(calls >= 2, 'socket lookup went through the guarded resolver');
  });

  it('matches common Korean and ISO date formats, requiring the year for month-day forms', () => {
    const date = '2026-11-30';
    for (const text of ['마감 2026.11.30', '2026-11-30 까지', '2026/11/30', '2026년 11월 30일(월)', '2026 모집 · 11월 30일 마감', '2026학년도 · 11.30(월) 18시', '2026. 11. 30.']) {
      assert.equal(dateAppearsInText(text, date), true, text);
    }
    for (const text of ['11월 30일 마감', '11.30(월)', '2026.11.3', '2026.11.300', '12026.11.30', '2025.11.30', '2026년 11월 3일', '2026년 안내: 지난 2025년 11월 30일 공고']) {
      assert.equal(dateAppearsInText(text, date), false, text);
    }
  });

  it('requires real title keyword overlap', () => {
    assert.equal(titleKeywordsOverlap('청년 데이터 분석 공모전', '2026 청년 데이터 분석 대회'), true);
    assert.equal(titleKeywordsOverlap('청년 데이터 분석 공모전', '데이터 관련 공지'), false);
    assert.equal(titleKeywordsOverlap('2026 모집 공고', '2026 모집 공고'), false, 'generic words alone are not evidence');
  });
});

describe('aiVerified adapter: only auto-verified candidates survive', () => {
  const backup = process.env.OPENAI_API_KEY;
  before(() => { process.env.OPENAI_API_KEY = 'sk-test-spec'; });
  beforeEach(() => resetRateLimit());
  after(() => {
    resetRateLimit();
    if (backup === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = backup;
  });

  function openAi(results) {
    const calls = [];
    const fn = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ status: 'completed', output: [
        { type: 'web_search_call', status: 'completed' },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ results }) }] },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    fn.calls = calls;
    return fn;
  }

  const base = { organizer: '과학기술정보통신부', apply_start: null, event_date: null, end_date: null, result_date: null, summary: '전국 대학생 대상' };
  const candidates = [
    { ...base, title: '청년 데이터 분석 공모전', url: 'https://www.contest.go.kr/notice/1', apply_end: '2026-11-30' },
    { ...base, title: '청년 데이터 분석 공모전 2차', url: 'https://www.contest.go.kr/notice/2', apply_end: '2026-12-24' },
    { ...base, title: '데이터 공모전', url: 'https://www.wevity.com/x', apply_end: '2026-11-30' },
    { ...base, title: '데이터 공모전', url: 'https://www.example.com/x', apply_end: '2026-11-30' },
  ];

  it('drops candidates that fail host allowlist or page evidence and reports the count', async () => {
    const aiFetchImpl = openAi(candidates);
    const verifyFetchImpl = async () => html(PAGE);
    const report = {};
    const items = await aiVerified.search({ kind: 'contest', fields: ['IT·SW'], keyword: '' }, { userId: 77, aiFetchImpl, verifyFetchImpl, dnsLookupImpl: publicLookup, report });
    assert.deepEqual(items.map((i) => i.title), ['청년 데이터 분석 공모전']);
    assert.equal(items[0].source, 'ai_verified');
    assert.equal(items[0].verified, true);
    assert.equal(report.dropped, 3);
    const req = aiFetchImpl.calls[0].body;
    assert.equal(req.tools[0].type, 'web_search');
    assert.deepEqual(req.tools[0].filters.allowed_domains, ['go.kr', 'or.kr', 'ac.kr', 're.kr', 'mil.kr']);
    assert.equal(req.text.format.strict, true);
  });

  it('shares the AI rate limit and refuses before calling OpenAI', async () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) checkRateLimit(88);
    const aiFetchImpl = openAi(candidates);
    await assert.rejects(aiVerified.search({ kind: 'grad_school', fields: ['AI·데이터사이언스'] }, { userId: 88, aiFetchImpl }), (e) => e.status === 429);
    assert.equal(aiFetchImpl.calls.length, 0);
  });

  it('reuses cached AI candidates but re-verifies page evidence on each search', async () => {
    const cache = new Map();
    const cacheService = {
      readExternalCache(db, source, hash) { return cache.get(`${source}:${hash}`) || null; },
      writeExternalCache(db, source, hash, payload) { cache.set(`${source}:${hash}`, payload); },
    };
    const aiFetchImpl = openAi([candidates[0]]);
    let page = PAGE;
    let pageCalls = 0;
    const context = { db: { open: true }, cacheService, userId: 101, aiFetchImpl,
      verifyFetchImpl: async () => { pageCalls += 1; return html(page); }, dnsLookupImpl: publicLookup, report: {} };
    const params = { kind: 'contest', fields: ['IT·SW'] };
    assert.equal((await aiVerified.search(params, context)).length, 1);
    page = '<p>공고가 종료되어 삭제되었습니다.</p>';
    assert.equal((await aiVerified.search(params, context)).length, 0);
    assert.equal(aiFetchImpl.calls.length, 1);
    assert.equal(pageCalls, 2);
    assert.equal(context.report.dropped, 1);
  });

  it('is disabled without OPENAI_API_KEY and makes no request', async () => {
    delete process.env.OPENAI_API_KEY;
    const aiFetchImpl = openAi(candidates);
    assert.deepEqual(await aiVerified.search({ kind: 'activity', fields: ['봉사'] }, { userId: 1, aiFetchImpl }), []);
    assert.equal(aiFetchImpl.calls.length, 0);
    process.env.OPENAI_API_KEY = 'sk-test-spec';
  });
});
