const OK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 200 * 1024;
const MIN_BYTES = 64;
const MIN_DIMENSION = 17;
const MAX_REDIRECTS = 2;

const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/jpeg',
  'image/webp',
]);

// Only these fixed favicon services are ever contacted; company hosts are never fetched (SSRF guard).
const FETCH_HOST_PATTERNS = [/^www\.google\.com$/, /^t[0-9]\.gstatic\.com$/, /^icons\.duckduckgo\.com$/];

const AGGREGATOR_DOMAINS = [
  'saramin.co.kr', 'jobkorea.co.kr', 'wanted.co.kr', 'wanted.jobs', 'albamon.com', 'alba.co.kr',
  'jobplanet.co.kr', 'linkareer.com', 'catch.co.kr', 'incruit.com', 'rocketpunch.com',
  'programmers.co.kr', 'linkedin.com', 'indeed.com', 'glassdoor.com', 'google.com', 'naver.com',
  'daum.net', 'tistory.com', 'velog.io', 'brunch.co.kr', 'notion.site', 'youtube.com',
  'jasoseol.com', 'jumpit.co.kr', 'superookie.com', 'peoplenjob.com', 'work.go.kr', 'worknet.go.kr',
];

const STRIPPABLE_PREFIXES = ['www', 'm', 'recruit', 'careers', 'career', 'jobs'];
const SECOND_LEVEL_SUFFIXES = new Set([
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr', 're.kr', 'pe.kr',
  'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp', 'com.au', 'com.cn', 'com.sg', 'com.tw',
]);

// RFC 1123 labels, at least two labels, alphabetic TLD (so IPv4 literals never match).
const HOSTNAME_REGEX = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

let fetchImpl = (...args) => globalThis.fetch(...args);
const inflight = new Map();

function setLogoFetchImpl(fn) {
  fetchImpl = typeof fn === 'function' ? fn : (...args) => globalThis.fetch(...args);
}

function isRegistrable(host) {
  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (SECOND_LEVEL_SUFFIXES.has(labels.slice(-2).join('.'))) return labels.length >= 3;
  return true;
}

function normalizeDomain(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  let host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME_REGEX.test(host) || host === 'localhost' || host.endsWith('.localhost')) return null;

  let labels = host.split('.');
  while (labels.length > 2 && STRIPPABLE_PREFIXES.includes(labels[0])) {
    const candidate = labels.slice(1).join('.');
    if (!isRegistrable(candidate)) break;
    labels = labels.slice(1);
  }
  host = labels.join('.');
  return isRegistrable(host) ? host : null;
}

function isAggregatorHost(host) {
  return AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function domainFromSourceUrl(url) {
  const domain = normalizeDomain(url);
  if (!domain || isAggregatorHost(domain)) return null;
  return domain;
}

function lookupCompanyDomain(db, userId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || !userId) return null;
  const row = db
    .prepare('SELECT website FROM companies WHERE user_id = ? AND name = ?')
    .get(userId, trimmed);
  if (!row || !row.website) return null;
  const domain = normalizeDomain(row.website);
  return domain && !isAggregatorHost(domain) ? domain : null;
}

function resolveLogoDomain(db, userId, { name, url } = {}) {
  if (url) {
    const fromUrl = domainFromSourceUrl(url);
    if (fromUrl) return fromUrl;
  }
  return lookupCompanyDomain(db, userId, name);
}

function sniffImage(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 22 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) {
    const count = buf.readUInt16LE(4);
    let max = 0;
    for (let i = 0; i < count && 6 + i * 16 + 2 <= buf.length; i += 1) {
      max = Math.max(max, buf[6 + i * 16] || 256, buf[7 + i * 16] || 256);
    }
    return { type: 'image/x-icon', width: max, height: max };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: 'image/jpeg', width: null, height: null };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { type: 'image/webp', width: null, height: null };
  }
  return null;
}

function isAllowedFetchUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.port && !u.username && FETCH_HOST_PATTERNS.some((re) => re.test(u.hostname));
  } catch (e) {
    return false;
  }
}

async function readCapped(res) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_BYTES) return null;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MAX_BYTES ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const MAX_CONCURRENT_FETCHES = 3;
let activeFetches = 0;
const fetchQueue = [];

async function withFetchSlot(task) {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise((resolve) => fetchQueue.push(resolve));
  }
  activeFetches += 1;
  try {
    return await task();
  } finally {
    activeFetches -= 1;
    const next = fetchQueue.shift();
    if (next) next();
  }
}

const MISSING = { kind: 'missing' };
const TRANSIENT = { kind: 'transient' };

async function fetchImageOnce(startUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedFetchUrl(url)) return MISSING;
      const res = await fetchImpl(url, { redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return MISSING;
        url = new URL(location, url).toString();
        continue;
      }
      if (res.status === 429 || res.status >= 500) return TRANSIENT;
      if (res.status !== 200) return MISSING;
      const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) return MISSING;
      const buf = await readCapped(res);
      if (!buf || buf.length < MIN_BYTES) return MISSING;
      const info = sniffImage(buf);
      if (!info) return MISSING;
      if (info.width !== null && (info.width < MIN_DIMENSION || info.height < MIN_DIMENSION)) return MISSING;
      return { kind: 'ok', contentType: info.type, data: buf };
    }
    return MISSING;
  } catch (e) {
    return TRANSIENT;
  } finally {
    clearTimeout(timer);
  }
}

function fetchImage(url) {
  return withFetchSlot(() => fetchImageOnce(url));
}

function providerUrls(domain) {
  const encoded = encodeURIComponent(domain);
  return [
    `https://www.google.com/s2/favicons?domain=${encoded}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${encoded}.ico`,
  ];
}

function readCache(db, domain) {
  const row = db.prepare('SELECT domain, content_type, data, status, fetched_at FROM company_logos WHERE domain = ?').get(domain);
  if (!row) return null;
  const ttl = row.status === 'ok' ? OK_TTL_MS : MISSING_TTL_MS;
  return Date.now() - row.fetched_at < ttl ? row : null;
}

function writeCache(db, domain, result) {
  db.prepare(
    `INSERT INTO company_logos (domain, content_type, data, status, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET content_type = excluded.content_type, data = excluded.data,
       status = excluded.status, fetched_at = excluded.fetched_at`
  ).run(domain, result ? result.contentType : null, result ? result.data : null, result ? 'ok' : 'missing', Date.now());
}

async function getLogoForDomain(db, domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  const cached = readCache(db, normalized);
  if (cached) return cached.status === 'ok' ? { contentType: cached.content_type, data: cached.data } : null;

  if (!inflight.has(normalized)) {
    const task = (async () => {
      let sawTransient = false;
      for (const url of providerUrls(normalized)) {
        const outcome = await fetchImage(url);
        if (outcome.kind === 'ok') {
          const result = { contentType: outcome.contentType, data: outcome.data };
          if (db.open) writeCache(db, normalized, result);
          return result;
        }
        if (outcome.kind === 'transient') sawTransient = true;
      }
      // Timeouts/5xx are not cached so a slow moment does not hide a logo for the full missing TTL.
      if (!sawTransient && db.open) writeCache(db, normalized, null);
      return null;
    })().finally(() => inflight.delete(normalized));
    inflight.set(normalized, task);
  }
  return inflight.get(normalized);
}

module.exports = {
  TRANSPARENT_PNG,
  AGGREGATOR_DOMAINS,
  setLogoFetchImpl,
  normalizeDomain,
  isAggregatorHost,
  domainFromSourceUrl,
  resolveLogoDomain,
  sniffImage,
  isAllowedFetchUrl,
  getLogoForDomain,
};
