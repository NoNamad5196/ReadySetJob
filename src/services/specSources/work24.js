const { fetchText, normalizeItem, httpUrl, text, hasKey, SpecSourceError } = require('./common');
const { parsePayload, rowsFrom } = require('./parse');
const { cachedSearch } = require('./cache');

const id = 'work24';
const label = '고용24 훈련과정';
const SOURCE_LABEL = '공식 데이터: 고용24';
const API_URL = 'https://www.work24.go.kr/cm/openApi/call/hr/callOpenApiSvcInfo310L01.do';
const REGIONS = ['', '11', '26', '27', '28', '29', '30', '31', '36', '41', '42', '43', '44', '45', '46', '47', '48', '50'];
const TRACKS = ['C0104', 'C0105', 'C0061'];
const NCS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'];
let fetchImpl = null;

function setFetchImpl(fn) { fetchImpl = typeof fn === 'function' ? fn : null; }
function isEnabled() { return hasKey('WORK24_AUTH_KEY'); }
function disabledReason() { return '고용24 오픈API 인증키 필요(기업회원 심사)'; }
function compact(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function spanMonths(value) {
  const raw = String(value || '3').replace('개월', '');
  return ['1', '3', '6'].includes(raw) ? Number(raw) : null;
}

function toItem(row) {
  const trprId = text(row.trprId, 80);
  const degree = text(row.trprDegr, 20);
  const title = text(row.title);
  if (!trprId || !degree || !title) return null;
  const sourceUrl = httpUrl(text(row.titleLink, 2000))
    || `https://www.work24.go.kr/hr/a/a/3100/selectTracseDetl.do?tracseId=${encodeURIComponent(trprId)}&tracseTme=${encodeURIComponent(degree)}`;
  return normalizeItem({
    kind: 'bootcamp', title, organizer: text(row.subTitle) || text(row.instNm) || text(row.address), source: id,
    source_ref: `${trprId}-${degree}`, source_url: sourceUrl, apply_start: null, apply_end: null,
    event_date: row.traStartDate, end_date: row.traEndDate, result_date: null,
    memo: text(row.address),
  });
}

async function search(params = {}, context = {}) {
  if (!isEnabled()) return [];
  const area = text(params.region, 2);
  const ncs = text(params.ncs || params.field || '20', 2);
  const track = text(params.track || params.course_type || 'C0104', 5);
  const span = spanMonths(params.months || params.duration);
  if (!REGIONS.includes(area) || !NCS.includes(ncs) || !TRACKS.includes(track) || !span) {
    throw new SpecSourceError('교육 분야, 지역, 시작 기간을 올바르게 선택해 주세요.', 422, 'input');
  }
  const start = context.now ? new Date(context.now) : new Date();
  const end = new Date(start.getFullYear(), start.getMonth() + span, start.getDate());
  const request = {
    returnType: 'JSON', outType: '1', pageNum: '1', pageSize: '100', srchTraStDt: compact(start),
    srchTraEndDt: compact(end), sort: 'ASC', sortCol: 'TRNG_BGDE', crseTracseSe: track, srchNcs1: ncs,
  };
  if (area) request.srchTraArea1 = area;
  return cachedSearch(id, { ...request, schema: 1 }, context, async () => {
    const query = new URLSearchParams({ ...request, authKey: String(process.env.WORK24_AUTH_KEY).trim() });
    return parsePayload(await fetchText(`${API_URL}?${query}`, { fetchImpl: context.fetchImpl || fetchImpl }));
  }, (payload) => rowsFrom(payload, ['srchList', 'srchList.scn_list', 'returnList'])
    .map(toItem).filter(Boolean));
}

module.exports = { id, label, SOURCE_LABEL, API_URL, isEnabled, disabledReason, search, setFetchImpl };
