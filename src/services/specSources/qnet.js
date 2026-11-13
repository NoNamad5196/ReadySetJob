const { fetchText, normalizeDate, normalizeItem, text, hasKey, SpecSourceError } = require('./common');
const { parsePayload, rowsFrom } = require('./parse');
const { cachedSearch } = require('./cache');
const certCatalog = require('./certCatalog');

const id = 'qnet';
const label = 'Q-Net (한국산업인력공단)';

const BASE_URL = 'https://apis.data.go.kr/B490007/qualExamSchd';
const OPERATION_PATH = '/getQualExamSchdList'; // 확인 필요: 활용신청 후 오퍼레이션·응답 계약 대조.
const SOURCE_LABEL = '공식 데이터: Q-Net';
const ORGANIZER = '한국산업인력공단';
const QNET_DETAIL_URL = 'https://www.q-net.or.kr/crf005.do?id=crf00503&jmCd=';

let fetchImpl = null;
function setFetchImpl(fn) {
  fetchImpl = typeof fn === 'function' ? fn : null;
}
function isEnabled() {
  return hasKey('DATA_GO_KR_SERVICE_KEY');
}

function disabledReason() {
  return '공공데이터포털 인증키(DATA_GO_KR_SERVICE_KEY)가 설정되지 않아 자격증 시험일정 검색을 사용할 수 없습니다.';
}

function serviceKey() {
  return String(process.env.DATA_GO_KR_SERVICE_KEY || '').trim();
}

function str(value) {
  return text(value);
}

function buildItem(row, certName, part, certCode) {
  const jmCd = str(row.jmCd) || certCode;
  const implYy = str(row.implYy);
  const implSeq = str(row.implSeq);
  const applyStart = normalizeDate(row[part === 'doc' ? 'docRegStartDt' : 'pracRegStartDt']);
  const applyEnd = normalizeDate(row[part === 'doc' ? 'docRegEndDt' : 'pracRegEndDt']);
  const eventDate = normalizeDate(row[part === 'doc' ? 'docExamStartDt' : 'pracExamStartDt']);
  const endDate = normalizeDate(row[part === 'doc' ? 'docExamEndDt' : 'pracExamEndDt']);
  const resultDate = normalizeDate(row[part === 'doc' ? 'docPassDt' : 'pracPassDt']);
  const partLabel = part === 'doc' ? '필기' : '실기';
  return normalizeItem({
    kind: 'certificate',
    title: `${certName} ${implYy}년 제${implSeq}회 ${partLabel}`,
    organizer: ORGANIZER,
    source: 'qnet',
    source_ref: `${jmCd}-${implYy}-${implSeq}-${part === 'doc' ? 'doc' : 'prac'}`,
    source_url: jmCd ? `${QNET_DETAIL_URL}${encodeURIComponent(jmCd)}` : '',
    apply_start: applyStart,
    apply_end: applyEnd,
    event_date: eventDate,
    end_date: endDate,
    result_date: resultDate,
    memo: str(row.description) || `국가자격 시험일정 · ${partLabel}`,
    cert_code: jmCd,
    cert_name: certName,
  });
}

async function search(params = {}, context = {}) {
  if (!isEnabled()) return [];
  const certCode = str(params.jmCd || params.cert_code);
  const catalogEntry = certCatalog.findByCode(certCode);
  const resolvedName = (catalogEntry && catalogEntry.name) || text(params.cert_name || params.jmName) || '국가자격';
  const year = str(params.implYy || params.year || new Date().getFullYear());
  const qualgbCd = str(params.qualgbCd || params.qualgb || 'T');
  if (!/^\d{1,8}$/.test(certCode) || !/^\d{4}$/.test(year) || !['T', 'S'].includes(qualgbCd)) {
    throw new SpecSourceError('자격증 코드와 조회 연도를 올바르게 선택해 주세요.', 422, 'input');
  }
  const requestParams = {
    numOfRows: '100', pageNo: '1', dataFormat: 'json', implYy: year, qualgbCd, jmCd: certCode,
  };
  return cachedSearch(id, { ...requestParams, schema: 1 }, context, async () => {
    const url = `${BASE_URL}${OPERATION_PATH}?${new URLSearchParams({ ...requestParams, serviceKey: serviceKey() })}`;
    return parsePayload(await fetchText(url, { fetchImpl: context.fetchImpl || fetchImpl }));
  }, (payload) => {
    const rows = rowsFrom(payload, ['response.body.items.item', 'response.body.items']);
    const results = [];
    for (const row of rows) {
      if (str(row.implYy) !== year || !/^\d{1,4}$/.test(str(row.implSeq))) continue;
      if (row.jmCd != null && str(row.jmCd) !== certCode) continue;
      if (row.qualgbCd != null && str(row.qualgbCd) !== qualgbCd) continue;
      for (const part of ['doc', 'prac']) {
        const prefix = part === 'doc' ? 'doc' : 'prac';
        if (!['RegStartDt', 'RegEndDt', 'ExamStartDt', 'ExamEndDt', 'PassDt'].some((suffix) => str(row[prefix + suffix]))) continue;
        const item = buildItem(row, resolvedName, part, certCode);
        if (item) results.push(item);
      }
    }
    return results;
  });
}

module.exports = {
  id,
  label,
  SOURCE_LABEL,
  BASE_URL,
  OPERATION_PATH,
  isEnabled,
  disabledReason,
  search,
  setFetchImpl,
};
