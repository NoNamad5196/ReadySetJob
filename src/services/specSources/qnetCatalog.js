const { fetchText, text, hasKey } = require('./common');
const { parsePayload, xmlRows } = require('./parse');
const { cachedSearch, CATALOG_TTL_MS } = require('./cache');
const certCatalog = require('./certCatalog');

const id = 'qnet_catalog';
const label = 'Q-Net 자격증 목록';
const BASE_URL = 'http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC';
const LIST_PATH = '/getList';
const CACHE_SOURCE = 'qnet_catalog';

let fetchImpl = null;
function setFetchImpl(fn) {
  fetchImpl = typeof fn === 'function' ? fn : null;
}
function isEnabled() {
  return hasKey('DATA_GO_KR_SERVICE_KEY');
}

function disabledReason() { return '공공데이터포털 인증키 필요 · 확인된 기본 자격증만 표시됩니다.'; }

function extractCatalogFromXml(xmlText) {
  return xmlRows(parsePayload(xmlText), 2000).flatMap((row) => {
    const jmCd = text(row.jmcd, 8);
    const name = text(row.jmfldnm);
    const qualgbCd = text(row.qualgbcd, 1);
    if (!/^\d{1,8}$/.test(jmCd) || !name || !['T', 'S'].includes(qualgbCd)) return [];
    return [{ jmCd, name, field: text(row.obligfldnm) || text(row.seriesnm) || '국가자격',
      series: text(row.seriesnm), qualgbCd, verifiedCode: true }];
  });
}

async function search(params = {}, context = {}) {
  const q = text(params.keyword, 40).toLowerCase();
  const code = text(params.code, 8);
  if (!q && !code) return [...certCatalog.CERTIFICATES];
  let entries = [];
  try {
    if (isEnabled()) {
      entries = await cachedSearch(CACHE_SOURCE, { all: true, schema: 1 }, context, async () => {
        const query = new URLSearchParams({ serviceKey: String(process.env.DATA_GO_KR_SERVICE_KEY).trim(), numOfRows: '2000', pageNo: '1' });
        return await fetchText(`${BASE_URL}${LIST_PATH}?${query}`, { fetchImpl: context.fetchImpl || fetchImpl });
      }, extractCatalogFromXml, CATALOG_TTL_MS);
    }
  } catch { entries = []; }
  const merged = new Map(entries.map((item) => [item.jmCd, item]));
  for (const item of certCatalog.CERTIFICATES) if (!merged.has(item.jmCd)) merged.set(item.jmCd, item);
  return [...merged.values()].filter((item) => (!code || item.jmCd === code) && item.name.toLowerCase().includes(q)).slice(0, 20);
}

async function searchCatalog(query, context = {}) { return search({ keyword: query }, context); }

async function resolveCert({ cert_code: certCode, cert_name: certName }, context = {}) {
  const code = String(certCode || '').trim();
  if (code && certCatalog.findByCode(code)) return certCatalog.findByCode(code);
  if (code) return (await search({ code }, context))[0] || null;
  const name = String(certName || '').trim();
  if (!name) return null;
  const matches = await searchCatalog(name, context);
  if (matches.length === 1) return matches[0];
  const exact = matches.find((m) => m.name === name);
  return exact || null;
}

module.exports = {
  id,
  label,
  BASE_URL,
  LIST_PATH,
  isEnabled,
  disabledReason,
  search,
  extractCatalogFromXml,
  searchCatalog,
  resolveCert,
  setFetchImpl,
};
