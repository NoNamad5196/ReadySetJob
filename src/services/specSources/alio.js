const { fetchText, normalizeItem, httpUrl, text, hasKey } = require('./common');
const { parsePayload, rowsFrom } = require('./parse');
const { cachedSearch } = require('./cache');

const id = 'alio';
const label = '공공기관 채용 (잡알리오)';
const SOURCE_LABEL = '공식 데이터: 잡알리오';
const BASE_URL = 'https://apis.data.go.kr/1051000/recruitment';
const LIST_PATH = '/list'; // 확인 필요: 목록 오퍼레이션 경로와 항목 필드명은 활용신청 후 대조.
const TITLE_KEYS = ['recrutPbancTtl', 'pbancTtl', 'recrutTtl', 'title'];
const INST_KEYS = ['instNm', 'pblntInstNm', 'institutionNm', 'instName'];
const START_KEYS = ['pbancBgngYmd', 'bgngYmd', 'startDate'];
const END_KEYS = ['pbancEndYmd', 'endYmd', 'endDate', 'closeDt'];
const URL_KEYS = ['srcUrl', 'detailUrl', 'recrutUrl', 'url'];
const ID_KEYS = ['recrutPblntSn', 'recrutPbancSn', 'sn', 'id'];
let fetchImpl = null;

function setFetchImpl(fn) { fetchImpl = typeof fn === 'function' ? fn : null; }
function isEnabled() { return hasKey('DATA_GO_KR_SERVICE_KEY'); }
function disabledReason() { return '공공데이터포털 인증키(DATA_GO_KR_SERVICE_KEY) 필요'; }
function pick(row, keys) {
  for (const key of keys) {
    const value = text(row[key], 300);
    if (value) return value;
  }
  return '';
}

function toItem(row) {
  const title = pick(row, TITLE_KEYS);
  const organizer = pick(row, INST_KEYS) || '공공기관';
  const ref = pick(row, ID_KEYS);
  if (!title) return null;
  const sourceUrl = httpUrl(pick(row, URL_KEYS)) || (ref ? `https://job.alio.go.kr/recruitview.do?idx=${encodeURIComponent(ref)}` : null);
  return normalizeItem({
    kind: 'other', category: 'job', title, organizer, source: id,
    source_ref: ref || `${organizer}-${title}-${pick(row, END_KEYS)}`.replace(/\s+/g, '').slice(0, 160),
    source_url: sourceUrl, apply_start: pick(row, START_KEYS), apply_end: pick(row, END_KEYS),
    event_date: null, end_date: null, result_date: null, memo: `공공기관 채용공시 · ${organizer}`,
  });
}

async function search(params = {}, context = {}) {
  if (!isEnabled()) return [];
  const request = { resultType: 'json', ongoingYn: 'Y', numOfRows: '50', pageNo: '1' };
  const keyword = text(params.keyword, 40);
  const region = text(params.region || params.workRgnLst, 20);
  if (keyword) request.recrutPbancTtl = keyword;
  if (region) request.workRgnLst = region;
  return cachedSearch(id, { ...request, schema: 1 }, context, async () => {
    const query = new URLSearchParams({ ...request, serviceKey: String(process.env.DATA_GO_KR_SERVICE_KEY).trim() });
    return parsePayload(await fetchText(`${BASE_URL}${LIST_PATH}?${query}`, { fetchImpl: context.fetchImpl || fetchImpl }));
  }, (payload) => rowsFrom(payload, ['result', 'response.body.items.item', 'response.body.items', 'data', 'items'])
    .map(toItem).filter(Boolean));
}

module.exports = { id, label, SOURCE_LABEL, BASE_URL, LIST_PATH, isEnabled, disabledReason, search, setFetchImpl };
