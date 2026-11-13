const { createHash } = require('node:crypto');
const aiService = require('../aiService');
const { normalizeItem, httpUrl, isRecord, text, withDeadline, readCapped, SpecSourceError } = require('./common');
const { verifyCandidate, isHostAllowed, PUBLIC_SUFFIXES, PRIVATE_CERT_HOSTS } = require('./verifier');
const { cachedSearch } = require('./cache');

const id = 'ai_verified';
const label = 'AI 검색 + 자동 검증';
const SOURCE_LABEL = '자동 검증됨';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_CANDIDATES = 8;
const VERIFY_CONCURRENCY = 4;
let fetchOverride = null;
function setFetchImpl(fn) { fetchOverride = typeof fn === 'function' ? fn : null; }
const KIND_MAP = { contest: 'contest', activity: 'activity', grad_school: 'grad_school', private_certificate: 'certificate', bootcamp: 'bootcamp' };
const VERIFY_KIND = { contest: 'contest', activity: 'activity', grad_school: 'grad_school', private_certificate: 'private_cert', bootcamp: 'bootcamp' };
const KIND_TEXT = { contest: '공모전', activity: '대외활동', grad_school: '대학원 신입생 모집', private_certificate: '민간자격 시험 일정', bootcamp: '부트캠프·교육과정 모집' };
const nullableString = { type: ['string', 'null'] };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array', maxItems: MAX_CANDIDATES,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'organizer', 'url', 'apply_start', 'apply_end', 'event_date', 'end_date', 'result_date', 'summary'],
        properties: {
          title: { type: 'string' }, organizer: { type: 'string' }, url: { type: 'string' }, summary: { type: 'string' },
          apply_start: nullableString, apply_end: nullableString, event_date: nullableString, end_date: nullableString, result_date: nullableString,
        },
      },
    },
  },
};

function isEnabled() { return aiService.isAiEnabled(); }
function disabledReason() { return aiService.AI_DISABLED_MESSAGE; }
function allowedDomains(kind) {
  if (kind === 'grad_school') return ['ac.kr'];
  if (kind === 'private_certificate') return PRIVATE_CERT_HOSTS;
  return PUBLIC_SUFFIXES;
}

function buildPrompt(params, today) {
  const focus = params.kind === 'private_certificate' ? params.private_cert : (params.fields || []).join(', ');
  return {
    instructions: [
      '당신은 한국의 스펙 일정 조사원입니다. 반드시 웹 검색으로 주최·시행 기관의 공식 공지 페이지만 찾으세요.',
      '집계·커뮤니티·블로그·뉴스 사이트는 제외합니다. 접수 마감일 또는 행사·시험일이 페이지 본문에 표시된 항목만 포함합니다.',
      `오늘은 ${today}입니다. 이미 마감된 항목은 제외하고 날짜는 YYYY-MM-DD, 모르면 null로 둡니다. 최대 ${MAX_CANDIDATES}건입니다.`,
    ].join('\n'),
    input: [`종류: ${KIND_TEXT[params.kind]}`, focus && `분야/대상: ${focus}`, params.degree && `학위: ${params.degree}`,
      params.keyword && `추가 키워드: ${params.keyword}`].filter(Boolean).join('\n'),
  };
}

function responseText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && part.type === 'refusal') throw new SpecSourceError('AI 안전 정책에 의해 요청이 거부되었습니다.');
      if (part && part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('');
}

async function requestCandidates(params, context) {
  const now = context.now ? new Date(context.now) : new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const body = {
    model: aiService.getFeatureModel('search'), ...buildPrompt(params, today), reasoning: { effort: 'low' },
    tools: [{ type: 'web_search', filters: { allowed_domains: allowedDomains(params.kind) }, user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' } }],
    tool_choice: 'required', text: { format: { type: 'json_schema', name: 'spec_candidates', strict: true, schema: SCHEMA } }, max_output_tokens: 4000,
  };
  const fetchFn = context.aiFetchImpl || context.fetchImpl || fetchOverride || aiService.getFetchImpl();
  const data = await withDeadline(async (signal) => {
    let res;
    try {
      res = await fetchFn(RESPONSES_URL, {
        method: 'POST', signal, body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(process.env.OPENAI_API_KEY).trim()}` },
      });
    } catch { throw new SpecSourceError('AI 검색 서버에 연결할 수 없습니다.'); }
    if (!res.ok) throw new SpecSourceError(res.status === 429 ? '요청이 많거나 사용 한도를 초과했습니다.' : 'AI 검색 요청에 실패했습니다.', res.status === 429 ? 429 : 502);
    try { return JSON.parse(await readCapped(res)); } catch { throw new SpecSourceError('AI 응답을 읽을 수 없습니다.'); }
  }, 8000);
  if (!isRecord(data) || (data.status && data.status !== 'completed')) throw new SpecSourceError('AI 응답이 완료되지 않았습니다.');
  if (!(data.output || []).some((item) => item && item.type === 'web_search_call' && item.status === 'completed')) {
    throw new SpecSourceError('AI 응답에서 완료된 웹 검색을 확인할 수 없습니다.');
  }
  let parsed;
  try { parsed = JSON.parse(responseText(data)); } catch { throw new SpecSourceError('AI 응답 형식이 올바르지 않습니다.'); }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) throw new SpecSourceError('AI 응답 형식이 올바르지 않습니다.');
  return parsed.results.slice(0, MAX_CANDIDATES).filter(isRecord);
}

function candidateItem(candidate, kind) {
  const url = httpUrl(text(candidate.url, 2000));
  if (!url || !isHostAllowed(new URL(url).hostname, VERIFY_KIND[kind])) return null;
  const keyDate = text(candidate.apply_end, 20) || text(candidate.event_date, 20);
  const ref = createHash('sha256').update(`${url}|${text(candidate.title)}|${keyDate}`).digest('hex').slice(0, 24);
  return normalizeItem({
    kind: KIND_MAP[kind], title: text(candidate.title), organizer: text(candidate.organizer), source: id, source_ref: ref, source_url: url,
    apply_start: candidate.apply_start, apply_end: candidate.apply_end, event_date: candidate.event_date,
    end_date: candidate.end_date, result_date: candidate.result_date, memo: text(candidate.summary, 500),
  });
}

async function search(params = {}, context = {}) {
  if (!KIND_MAP[params.kind]) throw new SpecSourceError('자동 검증 검색을 지원하지 않는 종류입니다.', 422, 'input');
  if (!isEnabled()) return [];
  const cacheParams = {
    kind: params.kind, fields: params.fields || [], degree: params.degree || '', private_cert: params.private_cert || '',
    keyword: params.keyword || '', region: params.region || '', model: aiService.getFeatureModel('search'), schema: 1,
  };
  return cachedSearch(id, cacheParams, context, async () => {
    const limit = aiService.checkRateLimit(context.userId);
    if (!limit.allowed) throw new SpecSourceError(limit.message, 429, 'rate_limit');
    return requestCandidates(params, context);
  }, async (raw) => verifyCandidates(raw, params.kind, context));
}

async function verifyCandidates(raw, kind, context) {
  if (!Array.isArray(raw)) throw new SpecSourceError('AI 응답 형식이 올바르지 않습니다.');
  raw = raw.slice(0, MAX_CANDIDATES);
  const candidates = raw.filter(isRecord).map((candidate) => candidateItem(candidate, kind)).filter(Boolean);
  const verified = [];
  for (let i = 0; i < candidates.length; i += VERIFY_CONCURRENCY) {
    const batch = candidates.slice(i, i + VERIFY_CONCURRENCY);
    const outcomes = await Promise.all(batch.map((item) => verifyCandidate(item, {
      kind: VERIFY_KIND[kind], fetchImpl: context.verifyFetchImpl, dnsLookupImpl: context.dnsLookupImpl,
    })));
    outcomes.forEach((outcome, index) => { if (outcome.verified) verified.push(batch[index]); });
  }
  if (context.report) context.report.dropped = (context.report.dropped || 0) + raw.length - verified.length;
  return verified;
}

module.exports = { id, label, SOURCE_LABEL, SCHEMA, isEnabled, disabledReason, allowedDomains, search, setFetchImpl };
