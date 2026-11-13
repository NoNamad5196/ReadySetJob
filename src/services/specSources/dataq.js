const { fetchText, normalizeItem, httpUrl, text, hasKey, SpecSourceError } = require('./common');
const { parsePayload, rowsFrom } = require('./parse');
const { cachedSearch } = require('./cache');

const id = 'dataq';
const label = '데이터자격 (한국데이터산업진흥원)';
const SOURCE_LABEL = '공식 데이터: 데이터자격';
const ORGANIZER = '한국데이터산업진흥원';
const SOURCE_URL = 'https://www.dataq.or.kr/';
const CERTS = ['SQLD', 'ADSP', 'DAP', 'DASP', 'SQLP'];
let fetchImpl = null;

function setFetchImpl(fn) { fetchImpl = typeof fn === 'function' ? fn : null; }

// Full Swagger URL is issued per account after 활용신청; only HTTPS odcloud endpoints are accepted.
function apiUrl() {
  const url = httpUrl(String(process.env.DATAQ_API_URL || '').trim());
  if (!url) return null;
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && parsed.hostname === 'api.odcloud.kr' && parsed.pathname.startsWith('/api/15062838/') ? url : null;
}

function isEnabled() { return Boolean(apiUrl() && hasKey('DATA_GO_KR_SERVICE_KEY')); }

function disabledReason() {
  if (!apiUrl()) return '데이터자격 API 주소(DATAQ_API_URL) 미설정 · 활용신청 후 Swagger 주소 필요';
  return '공공데이터포털 인증키(DATA_GO_KR_SERVICE_KEY) 필요';
}

function field(row, keys) {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return '';
}

function toItem(row) {
  const title = field(row, ['시험명', 'examNm']);
  const round = field(row, ['회차', 'examRound']);
  if (!title) return null;
  const startTime = field(row, ['시험시작시간']);
  const memo = [field(row, ['시험구분']), field(row, ['시험유형']), field(row, ['시험장소']), startTime && `시험 시작 ${startTime}`]
    .filter(Boolean).join(' · ');
  return normalizeItem({
    kind: 'certificate', title: round ? `${title} ${round}` : title, organizer: ORGANIZER, source: id,
    source_ref: `${title}-${round || field(row, ['시험일'])}`.replace(/\s+/g, '').slice(0, 160), source_url: SOURCE_URL,
    apply_start: field(row, ['접수시작일']), apply_end: field(row, ['접수마감일']), event_date: field(row, ['시험일']),
    end_date: field(row, ['시험일']), result_date: field(row, ['합격자발표일']), memo,
  });
}

async function search(params = {}, context = {}) {
  if (!isEnabled()) return [];
  const cert = text(params.cert || params.private_cert, 10).toUpperCase();
  if (cert && !CERTS.includes(cert)) throw new SpecSourceError('데이터자격 종류를 올바르게 선택해 주세요.', 422, 'input');
  const url = apiUrl();
  const request = { page: '1', perPage: '100', returnType: 'JSON' };
  return cachedSearch(id, { url, ...request, schema: 1 }, context, async () => {
    const target = new URL(url);
    for (const [key, value] of Object.entries(request)) target.searchParams.set(key, value);
    target.searchParams.set('serviceKey', String(process.env.DATA_GO_KR_SERVICE_KEY).trim());
    return parsePayload(await fetchText(target.toString(), { fetchImpl: context.fetchImpl || fetchImpl }));
  }, (payload) => rowsFrom(payload, ['data', 'response.body.items.item'])
    .filter((row) => !cert || field(row, ['시험명', 'examNm']).toUpperCase().replace(/\s/g, '').includes(cert))
    .map(toItem).filter(Boolean));
}

module.exports = { id, label, SOURCE_LABEL, isEnabled, disabledReason, search, setFetchImpl };
