const { createHash } = require('node:crypto');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DATE_FIELDS = ['apply_start', 'apply_end', 'event_date', 'end_date', 'result_date'];
const ITEM_KINDS = ['certificate', 'bootcamp', 'contest', 'activity', 'grad_school', 'other'];
const ITEM_SOURCES = ['qnet', 'dataq', 'alio', 'work24', 'ai_verified'];
let customFetch = null;

class SpecSourceError extends Error {
  constructor(message, status = 502, code = 'upstream') {
    super(message);
    this.name = 'SpecSourceError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

function setFetchImpl(fn) { customFetch = typeof fn === 'function' ? fn : null; }
function getFetchImpl(fn) { return fn || customFetch || globalThis.fetch; }
function hasKey(name) { return Boolean(String(process.env[name] || '').trim()); }
function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function text(value, max = 200) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? String(value).trim().slice(0, max) : '';
}

function normalizeDate(value) {
  const raw = text(value, 40);
  const match = /^\d{8}$/.test(raw)
    ? raw.match(/^(\d{4})(\d{2})(\d{2})$/)
    : raw.match(/^(\d{4})(?:[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?|년\s*(\d{1,2})월\s*(\d{1,2})일)$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2] || match[4]);
  const day = Number(match[3] || match[5]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function httpUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const authority = value.match(/^https?:\/\/([^/?#]+)/i);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!authority || authority[1].includes(':')) return null;
    return url.toString();
  } catch { return null; }
}

function normalizeItem(raw) {
  if (!isRecord(raw) || !ITEM_KINDS.includes(raw.kind) || !ITEM_SOURCES.includes(raw.source)) return null;
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 200) return null;
  if (raw.organizer != null && typeof raw.organizer !== 'string') return null;
  if (DATE_FIELDS.some((key) => raw[key] != null && !['string', 'number'].includes(typeof raw[key]))) return null;
  const sourceUrl = httpUrl(raw.source_url);
  const sourceRef = text(raw.source_ref, 160);
  if (!sourceUrl || sourceUrl.length > 2000 || !sourceRef) return null;
  const item = {
    kind: raw.kind, title: raw.title.trim(), organizer: text(raw.organizer), source: raw.source,
    source_ref: sourceRef, source_url: sourceUrl, memo: text(raw.memo, 2000), verified: true,
  };
  for (const key of DATE_FIELDS) item[key] = normalizeDate(raw[key]);
  if (item.apply_start && item.apply_end && item.apply_start > item.apply_end) return null;
  if (item.event_date && item.end_date && item.event_date > item.end_date) return null;
  if (raw.category === 'job' && raw.source === 'alio') item.category = 'job';
  if (raw.cert_code && raw.cert_name) {
    item.cert_code = text(raw.cert_code, 20);
    item.cert_name = text(raw.cert_name);
  }
  return item;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function queryHash(params) { return createHash('sha256').update(stableJson(params)).digest('hex'); }

async function withDeadline(task, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SpecSourceError('외부 데이터 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.', 504, 'timeout'));
    }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => task(controller.signal)), expired]); }
  finally { clearTimeout(timer); }
}

async function cancelBody(response) {
  if (response.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
}

async function readCapped(response, maxBytes = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await cancelBody(response);
    throw new SpecSourceError('외부 데이터 응답이 허용 크기를 초과했습니다.', 502, 'size');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new SpecSourceError('외부 데이터 응답이 허용 크기를 초과했습니다.', 502, 'size');
    return buffer.toString('utf8');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new SpecSourceError('외부 데이터 응답이 허용 크기를 초과했습니다.', 502, 'size');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

async function fetchText(url, options = {}) {
  const types = options.types || ['application/json', 'application/xml', 'text/xml', 'text/plain'];
  return withDeadline(async (signal) => {
    try {
      const response = await getFetchImpl(options.fetchImpl)(url, { ...options.init, redirect: 'error', signal });
      if (!response || response.status < 200 || response.status >= 300) {
        await cancelBody(response);
        throw new SpecSourceError('외부 데이터 요청에 실패했습니다. 인증과 활용신청 상태를 확인해 주세요.', response && response.status === 429 ? 429 : 502);
      }
      const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!types.includes(type)) {
        await cancelBody(response);
        throw new SpecSourceError('외부 데이터 응답 형식이 올바르지 않습니다.', 502, 'schema');
      }
      return await readCapped(response, options.maxBytes || MAX_BYTES);
    } catch (error) {
      if (error instanceof SpecSourceError) throw error;
      // Never forward upstream errors: their messages may contain credential-bearing URLs.
      throw new SpecSourceError('외부 데이터에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, options.timeoutMs || TIMEOUT_MS);
}

module.exports = {
  SpecSourceError, TIMEOUT_MS, MAX_BYTES, CACHE_TTL_MS, DATE_FIELDS, ITEM_KINDS, ITEM_SOURCES,
  setFetchImpl, getFetchImpl, hasKey, isRecord, text, normalizeDate, normalizeItem, httpUrl,
  queryHash, withDeadline, readCapped, cancelBody, fetchText,
};
