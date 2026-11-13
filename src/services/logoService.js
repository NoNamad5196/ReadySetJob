const OK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
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

const STRIPPABLE_PREFIXES = [
  'www', 'm', 'recruit', 'careers', 'career', 'jobs',
  'about', 'corp', 'company', 'info', 'team', 'tech', 'kr', 'global', 'developers',
];
const SECOND_LEVEL_SUFFIXES = new Set([
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr', 're.kr', 'pe.kr',
  'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp', 'com.au', 'com.cn', 'com.sg', 'com.tw',
]);

const DOMAIN_ALIASES = {
  'coupang.jobs': ['coupang.com'],
  'musinsacareers.com': ['musinsa.com'],
  'yanolja.co': ['yanolja.com'],
  'navercorp.com': ['naver.com'],
  'linecorp.com': ['line.me'],
  'ridicorp.com': ['ridibooks.com'],
  'woowahan.com': ['baemin.com'],
};

const KNOWN_COMPANY_DOMAINS = {
  '토스': ['toss.im'],
  '비바리퍼블리카': ['toss.im'],
  '토스뱅크': ['tossbank.com', 'toss.im'],
  '토스증권': ['tossinvest.com', 'toss.im'],
  '토스페이먼츠': ['tosspayments.com', 'toss.im'],
  '카카오': ['kakao.com'],
  '카카오뱅크': ['kakaobank.com', 'kakao.com'],
  '카카오페이': ['kakaopay.com', 'kakao.com'],
  '네이버': ['navercorp.com', 'naver.com'],
  '당근': ['daangn.com'],
  '당근마켓': ['daangn.com'],
  '라인': ['linecorp.com', 'line.me'],
  '라인플러스': ['linecorp.com', 'line.me'],
  '우아한형제들': ['woowahan.com', 'baemin.com'],
  '배달의민족': ['baemin.com', 'woowahan.com'],
  '쿠팡': ['coupang.com', 'coupang.jobs'],
  '무신사': ['musinsa.com', 'musinsacareers.com'],
  '리디': ['ridicorp.com', 'ridibooks.com'],
  '리디북스': ['ridibooks.com', 'ridicorp.com'],
  '하이퍼커넥트': ['hyperconnect.com'],
  '야놀자': ['yanolja.com', 'yanolja.co'],
  '뱅크샐러드': ['banksalad.com'],
  '삼성전자': ['samsung.com', 'samsung.co.kr'],
  '삼성': ['samsung.com', 'samsung.co.kr'],
  'lg전자': ['lge.co.kr', 'lg.com'],
  'sk하이닉스': ['skhynix.com'],
  '현대자동차': ['hyundai.com'],
  '크래프톤': ['krafton.com'],
  '넥슨': ['nexon.com'],
  '엔씨소프트': ['ncsoft.com'],
  '넷마블': ['netmarble.com'],
  '두나무': ['dunamu.com', 'upbit.com'],
  '쏘카': ['socar.kr'],
  '컬리': ['kurly.com'],
  '마켓컬리': ['kurly.com'],
  '오늘의집': ['ohou.se'],
  '버킷플레이스': ['ohou.se'],
  '직방': ['zigbang.com'],
  '강남언니': ['gangnamunni.com'],
  '센드버드': ['sendbird.com'],
  '채널코퍼레이션': ['channel.io'],
  '채널톡': ['channel.io'],
  '업스테이지': ['upstage.ai'],
  '뤼튼': ['wrtn.ai'],
};

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

function canonicalCompanyName(rawName) {
  return String(rawName || '')
    .trim()
    .replace(/^\(주\)\s*|^주식회사\s*|^㈜\s*|\s*\(주\)$|\s*주식회사$|\s*㈜$/gi, '')
    .trim()
    .toLowerCase();
}

function expandDomainCandidates(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [];
  const out = [normalized];
  const aliases = DOMAIN_ALIASES[normalized] || [];
  for (const a of aliases) {
    if (!out.includes(a)) out.push(a);
  }
  const labels = normalized.split('.');
  const minLabels = SECOND_LEVEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  if (labels.length > minLabels) {
    const rootDomain = labels.slice(-minLabels).join('.');
    if (isRegistrable(rootDomain) && !isAggregatorHost(rootDomain) && !out.includes(rootDomain)) {
      out.push(rootDomain);
    }
  }
  return out;
}

function lookupCompanyDomains(db, userId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || !userId) return [];
  const canonical = canonicalCompanyName(trimmed);
  let row = db
    .prepare('SELECT id, name, website FROM companies WHERE user_id = ? AND lower(trim(name)) = lower(?)')
    .get(userId, trimmed);
  if (!row && canonical) {
    const userCompanies = db
      .prepare('SELECT id, name, website FROM companies WHERE user_id = ?')
      .all(userId);
    row = userCompanies.find((c) => canonicalCompanyName(c.name) === canonical) || null;
  }
  if (!row) return [];

  const candidates = [];
  const addCandidate = (d) => {
    for (const expanded of expandDomainCandidates(d)) {
      if (!isAggregatorHost(expanded) && !candidates.includes(expanded)) {
        candidates.push(expanded);
      }
    }
  };

  if (row.website) {
    addCandidate(row.website);
  }

  const jobUrls = db
    .prepare("SELECT url FROM job_posts WHERE user_id = ? AND company_id = ? AND url IS NOT NULL AND url != '' ORDER BY id DESC LIMIT 5")
    .all(userId, row.id);
  for (const j of jobUrls) {
    const fromJob = domainFromSourceUrl(j.url);
    if (fromJob) addCandidate(fromJob);
  }

  const known = KNOWN_COMPANY_DOMAINS[canonical] || KNOWN_COMPANY_DOMAINS[trimmed.toLowerCase()] || [];
  for (const d of known) {
    if (!candidates.includes(d)) candidates.push(d);
  }

  return candidates;
}

function lookupCompanyDomain(db, userId, name) {
  const domains = lookupCompanyDomains(db, userId, name);
  return domains[0] || null;
}

function resolveLogoDomains(db, userId, { name, url } = {}) {
  const candidates = [];
  const add = (d) => {
    if (d && !candidates.includes(d)) candidates.push(d);
  };
  if (url) {
    const fromUrl = domainFromSourceUrl(url);
    if (fromUrl) {
      for (const d of expandDomainCandidates(fromUrl)) {
        add(d);
      }
    }
  }
  for (const d of lookupCompanyDomains(db, userId, name)) {
    add(d);
  }
  return candidates;
}

function resolveLogoDomain(db, userId, { name, url } = {}) {
  const domains = resolveLogoDomains(db, userId, { name, url });
  return domains[0] || null;
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
  const age = Date.now() - Number(row.fetched_at);
  if (!Number.isFinite(age) || age < 0 || age >= ttl) {
    if (db.open) {
      db.prepare('DELETE FROM company_logos WHERE domain = ?').run(domain);
    }
    return null;
  }
  return row;
}

function writeCache(db, domain, result) {
  db.prepare(
    `INSERT INTO company_logos (domain, content_type, data, status, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET content_type = excluded.content_type, data = excluded.data,
       status = excluded.status, fetched_at = excluded.fetched_at`
  ).run(domain, result ? result.contentType : null, result ? result.data : null, result ? 'ok' : 'missing', Date.now());
}

async function fetchLogoForSingleDomain(db, normalized) {
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

async function getLogoForDomain(db, domain) {
  const candidates = expandDomainCandidates(domain);
  if (!candidates.length) return null;
  for (const candidate of candidates) {
    const result = await fetchLogoForSingleDomain(db, candidate);
    if (result) return result;
  }
  return null;
}

module.exports = {
  OK_TTL_MS,
  MISSING_TTL_MS,
  TRANSPARENT_PNG,
  AGGREGATOR_DOMAINS,
  setLogoFetchImpl,
  normalizeDomain,
  isAggregatorHost,
  domainFromSourceUrl,
  resolveLogoDomain,
  resolveLogoDomains,
  sniffImage,
  isAllowedFetchUrl,
  getLogoForDomain,
};
