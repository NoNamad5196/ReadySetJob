const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { normalizeDate, fetchText, SpecSourceError } = require('../src/services/specSources/common');
const { parsePayload } = require('../src/services/specSources/parse');
const qnet = require('../src/services/specSources/qnet');
const qnetCatalog = require('../src/services/specSources/qnetCatalog');
const dataq = require('../src/services/specSources/dataq');
const alio = require('../src/services/specSources/alio');
const work24 = require('../src/services/specSources/work24');
const { runDiscover, sourceStatuses } = require('../src/services/specSources');

const ENV = ['DATA_GO_KR_SERVICE_KEY', 'WORK24_AUTH_KEY', 'DATAQ_API_URL', 'OPENAI_API_KEY'];
const KEY = 'secret+key/=';
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const xml = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/xml' } });

function recorder(...responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return typeof next === 'function' ? next() : next.clone();
  };
  fn.calls = calls;
  return fn;
}

const QNET_ROW = {
  implYy: '2026', implSeq: '1', qualgbCd: 'T', qualgbNm: '국가기술자격', description: '정기 기사 1회',
  docRegStartDt: '20260113', docRegEndDt: '20260116', docExamStartDt: '20260207', docExamEndDt: '20260303', docPassDt: '20260311',
  pracRegStartDt: '20260323', pracRegEndDt: '20260326', pracExamStartDt: '20260418', pracExamEndDt: '20260508', pracPassDt: '20260231',
};
const qnetBody = (item) => ({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { items: { item } } } });

describe('spec sources: parsing, normalization, cache, adapters', () => {
  const backup = {};
  let db;
  let dir;
  before(() => {
    ENV.forEach((k) => { backup[k] = process.env[k]; });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-sources-'));
    db = openDatabase(path.join(dir, 't.db'));
    migrate(db);
  });
  beforeEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    db.prepare('DELETE FROM external_cache').run();
  });
  after(() => {
    ENV.forEach((k) => (backup[k] === undefined ? delete process.env[k] : (process.env[k] = backup[k])));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('normalizes YYYYMMDD / ISO / Korean dates and rejects invalid calendar values', () => {
    assert.equal(normalizeDate('20261130'), '2026-11-30');
    assert.equal(normalizeDate('2026.11.30'), '2026-11-30');
    assert.equal(normalizeDate('2026년 11월 30일'), '2026-11-30');
    for (const bad of ['20260231', '2026011', '2026-13-01', '', null, 'tomorrow', 20261130.5]) assert.equal(normalizeDate(bad), null);
  });

  it('rejects data.go.kr error shapes: JSON resultCode and XML error body even when JSON was requested', () => {
    assert.throws(() => parsePayload(JSON.stringify({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } })), SpecSourceError);
    const errXml = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
    assert.throws(() => parsePayload(errXml), /인증과 활용신청/);
    assert.throws(() => parsePayload('<!DOCTYPE x [<!ENTITY a "b">]><response/>'), /허용되지 않은 XML/);
    assert.throws(() => parsePayload('not json'), /읽을 수 없습니다/);
  });

  it('caps response size, enforces timeout and content type without leaking the request URL', async () => {
    const huge = async () => new Response('x', { headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) } });
    await assert.rejects(fetchText(`https://x.test/?serviceKey=${KEY}`, { fetchImpl: huge }), (e) => e.code === 'size' && !e.message.includes(KEY));
    const streamed = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(512 * 1024)); } }), { headers: { 'content-type': 'text/plain' } });
    await assert.rejects(fetchText('https://x.test/', { fetchImpl: streamed }), (e) => e.code === 'size');
    const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error(url))));
    await assert.rejects(fetchText(`https://x.test/?serviceKey=${KEY}`, { fetchImpl: hang, timeoutMs: 30 }), (e) => e.status === 504 && !e.message.includes(KEY));
    const html = async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(fetchText('https://x.test/', { fetchImpl: html }), (e) => e.code === 'schema');
    const boom = async () => { throw new Error(`connect failed https://x.test/?serviceKey=${KEY}`); };
    await assert.rejects(fetchText('https://x.test/', { fetchImpl: boom }), (e) => !e.message.includes(KEY));
  });

  it('every adapter is disabled without its key and returns no data instead of calling the network', async () => {
    const fetchImpl = recorder(json({}));
    for (const adapter of [qnet, dataq, alio, work24]) {
      assert.equal(adapter.isEnabled(), false);
      assert.deepEqual(await adapter.search({ cert_code: '1320', year: '2026' }, { fetchImpl }), []);
    }
    assert.equal(fetchImpl.calls.length, 0);
    const reasons = Object.fromEntries(sourceStatuses().map((s) => [s.id, s.reason]));
    assert.equal(reasons.work24, '고용24 오픈API 인증키 필요(기업회원 심사)');
    assert.match(reasons.dataq, /DATAQ_API_URL/);
    process.env.DATAQ_API_URL = 'https://evil.example/api/15062838/v1/x';
    process.env.DATA_GO_KR_SERVICE_KEY = KEY;
    assert.equal(dataq.isEnabled(), false, 'only api.odcloud.kr dataset URLs are accepted');
  });

  it('Q-Net splits a row into 필기/실기 items, normalizes dates and caches by params without the key', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = KEY;
    const fetchImpl = recorder(json(qnetBody([QNET_ROW])));
    const items = await qnet.search({ cert_code: '1320', year: '2026' }, { db, fetchImpl });
    assert.deepEqual(items.map((i) => i.title), ['정보처리기사 2026년 제1회 필기', '정보처리기사 2026년 제1회 실기']);
    const [doc, prac] = items;
    assert.equal(doc.source_ref, '1320-2026-1-doc');
    assert.equal(doc.source_url, 'https://www.q-net.or.kr/crf005.do?id=crf00503&jmCd=1320');
    assert.deepEqual([doc.apply_start, doc.apply_end, doc.event_date, doc.end_date, doc.result_date], ['2026-01-13', '2026-01-16', '2026-02-07', '2026-03-03', '2026-03-11']);
    assert.equal(prac.result_date, null, 'invalid 20260231 becomes null');
    assert.equal(doc.verified, true);
    assert.equal(new URL(fetchImpl.calls[0]).searchParams.get('serviceKey'), KEY);
    assert.match(fetchImpl.calls[0], /\/getQualExamSchdList\?/);
    const cached = db.prepare('SELECT payload_json FROM external_cache WHERE source = ?').get('qnet');
    assert.ok(cached && !cached.payload_json.includes(KEY));

    const again = await qnet.search({ cert_code: '1320', year: '2026' }, { db, fetchImpl });
    assert.equal(again.length, 2);
    assert.equal(fetchImpl.calls.length, 1, 'second search is served from external_cache');
    db.prepare('UPDATE external_cache SET fetched_at = ? WHERE source = ?').run(Date.now() - 13 * 60 * 60 * 1000, 'qnet');
    await qnet.search({ cert_code: '1320', year: '2026' }, { db, fetchImpl });
    assert.equal(fetchImpl.calls.length, 2, '12-hour TTL expiry triggers a fresh fetch');
  });

  it('Q-Net accepts a single-object item, an empty body, and surfaces error XML as SpecSourceError', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = KEY;
    const single = await qnet.search({ cert_code: '1320', year: '2026' }, { fetchImpl: recorder(json(qnetBody({ ...QNET_ROW, pracRegStartDt: '', pracRegEndDt: '', pracExamStartDt: '', pracExamEndDt: '', pracPassDt: '' }))) });
    assert.equal(single.length, 1);
    const empty = await qnet.search({ cert_code: '1320', year: '2026' }, { fetchImpl: recorder(json({ response: { header: { resultCode: '00' }, body: { items: '' } } })) });
    assert.deepEqual(empty, []);
    await assert.rejects(qnet.search({ cert_code: '1320', year: '2026' }, { fetchImpl: recorder(xml('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>')) }), SpecSourceError);
    await assert.rejects(qnet.search({ cert_code: '13;20', year: '2026' }, { fetchImpl: recorder(json({})) }), (e) => e.status === 422);
  });

  it('Q-Net catalog parses the official XML list and falls back to the confirmed static entry', async () => {
    const fallback = await qnetCatalog.search({ keyword: '정보처리' });
    assert.deepEqual(fallback.map((c) => c.jmCd), ['1320']);
    process.env.DATA_GO_KR_SERVICE_KEY = KEY;
    const body = '<response><header><resultCode>00</resultCode></header><body><items><item><jmcd>9999</jmcd><jmfldnm>테스트기사</jmfldnm><qualgbcd>T</qualgbcd><seriesnm>기사</seriesnm><obligfldnm>정보통신</obligfldnm></item><item><jmcd>bad</jmcd><jmfldnm>x</jmfldnm><qualgbcd>T</qualgbcd></item></items></body></response>';
    const found = await qnetCatalog.search({ keyword: '테스트' }, { db, fetchImpl: recorder(xml(body)) });
    assert.deepEqual(found.map((c) => [c.jmCd, c.name]), [['9999', '테스트기사']]);
    const broken = await qnetCatalog.search({ keyword: '정보처리' }, { fetchImpl: recorder(xml('<OpenAPI_ServiceResponse/>')) });
    assert.deepEqual(broken.map((c) => c.jmCd), ['1320']);
  });

  it('DataQ maps Korean columns and filters by certificate', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = KEY;
    process.env.DATAQ_API_URL = 'https://api.odcloud.kr/api/15062838/v1/uddi:test';
    const fetchImpl = recorder(json({ data: [
      { 시험명: 'SQL 개발자(SQLD)', 시험구분: '정기', 회차: '제60회', 시험일: '2026-03-07', 시험시작시간: '10:00', 접수시작일: '2026-02-02', 접수마감일: '2026-02-06', 시험장소: '서울', 합격자발표일: '2026-04-03', 시험유형: '필기' },
      { 시험명: '데이터분석 준전문가(ADsP)', 회차: '제48회', 시험일: '20260214' },
    ] }));
    const items = await dataq.search({ cert: 'SQLD' }, { fetchImpl });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'SQL 개발자(SQLD) 제60회');
    assert.deepEqual([items[0].apply_end, items[0].event_date, items[0].result_date], ['2026-02-06', '2026-03-07', '2026-04-03']);
    assert.match(items[0].memo, /시험 시작 10:00/);
    assert.equal(new URL(fetchImpl.calls[0]).hostname, 'api.odcloud.kr');
  });

  it('ALIO parses defensively, flags jobs and never trusts non-http URLs', async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = KEY;
    const fetchImpl = recorder(json({ resultCode: 200, result: [
      { recrutPblntSn: '301', recrutPbancTtl: '2026 신입 채용', instNm: '한국전력공사', pbancBgngYmd: '20261101', pbancEndYmd: '20261130', srcUrl: 'javascript:alert(1)' },
      { instNm: '제목 없음' },
    ] }));
    const items = await alio.search({ keyword: '신입' }, { fetchImpl });
    assert.equal(items.length, 1);
    assert.equal(items[0].category, 'job');
    assert.equal(items[0].kind, 'other');
    assert.equal(items[0].apply_end, '2026-11-30');
    assert.match(items[0].source_url, /^https:\/\/job\.alio\.go\.kr\//);
    assert.equal(new URL(fetchImpl.calls[0]).searchParams.get('recrutPbancTtl'), '신입');
  });

  it('Work24 maps courses to bootcamp items with request filters and no apply_end', async () => {
    process.env.WORK24_AUTH_KEY = KEY;
    const fetchImpl = recorder(json({ srchList: [{ title: '클라우드 풀스택 과정', subTitle: '코딩아카데미', address: '서울 강남구', titleLink: 'https://www.work24.go.kr/c/1', traStartDate: '2026-12-01', traEndDate: '20270531', trprId: 'AIG2026', trprDegr: '3' }] }));
    const items = await work24.search({ ncs: '20', region: '11', months: '3', track: 'C0104' }, { fetchImpl, now: '2026-11-12T00:00:00' });
    assert.equal(items[0].kind, 'bootcamp');
    assert.equal(items[0].source_ref, 'AIG2026-3');
    assert.deepEqual([items[0].apply_end, items[0].event_date, items[0].end_date], [null, '2026-12-01', '2027-05-31']);
    const query = new URL(fetchImpl.calls[0]).searchParams;
    assert.deepEqual(['srchTraStDt', 'srchTraEndDt', 'srchTraArea1', 'crseTracseSe', 'srchNcs1', 'pageSize'].map((k) => query.get(k)), ['20261112', '20270212', '11', 'C0104', '20', '100']);
    await assert.rejects(work24.search({ region: '99' }, { fetchImpl }), (e) => e.status === 422);
  });

  it('runDiscover reports disabled sources instead of failing the whole search', async () => {
    const outcome = await runDiscover({ kind: 'bootcamp', region: '', months: '3', ncs: '20', track: 'C0104', fields: [] }, { db });
    assert.deepEqual(outcome.items, []);
    assert.deepEqual(outcome.notices.map((n) => n.source), ['work24', 'ai_verified']);
  });
});
