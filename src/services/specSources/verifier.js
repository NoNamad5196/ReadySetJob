const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { Readable } = require('node:stream');
const { AGGREGATOR_DOMAINS } = require('../logoService');
const { normalizeDate, readCapped, withDeadline, cancelBody } = require('./common');
const { decodeEntities } = require('./parse');

const VERIFY_TIMEOUT_MS = 5000;
const MAX_VERIFY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 2;
const PUBLIC_SUFFIXES = ['go.kr', 'or.kr', 'ac.kr', 're.kr', 'mil.kr'];
const PRIVATE_CERT_HOSTS = ['exam.toeic.co.kr', 'opic.or.kr', 'dataq.or.kr'];
const BLOCKED_HOSTS = [...AGGREGATOR_DOMAINS, 'wevity.com', 'thinkcontest.com', 'allcon.or.kr', 'all-con.co.kr', 'detizen.com', 'campuspick.com', 'contestkorea.com'];
const STOP_WORDS = new Set(['모집', '공고', '안내', '접수', '신청', '선발', '대회', '프로그램', '참가자', '년도', '시험', '일정']);
let fetchOverride = null;
let lookupOverride = null;

function setVerifierFetchImpl(fn) { fetchOverride = typeof fn === 'function' ? fn : null; }
function setDnsLookupImpl(fn) { lookupOverride = typeof fn === 'function' ? fn : null; }
function hostMatches(host, domain) { return host === domain || host.endsWith(`.${domain}`); }

function isHostAllowed(hostname, kind) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || net.isIP(host) || BLOCKED_HOSTS.some((domain) => hostMatches(host, domain))) return false;
  if (kind === 'grad_school') return host.endsWith('.ac.kr');
  if (kind === 'private_cert') return PRIVATE_CERT_HOSTS.some((domain) => hostMatches(host, domain));
  if (['contest', 'activity', 'bootcamp'].includes(kind)) return PUBLIC_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`));
  return false;
}

function ipv4Blocked(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

function isPrivateOrReservedIp(address) {
  const ip = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return ipv4Blocked(ip);
  if (!net.isIPv6(ip)) return true;
  const mapped = ip.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) || ip.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return true;
  if (ip === '::' || ip === '::1' || ip.startsWith('64:ff9b:') || ip.startsWith('2001:db8') || ip.startsWith('2002:')) return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xe000) !== 0x2000 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
    || (first & 0xff00) === 0xff00 || first === 0x2001 && /^2001:0*:/.test(ip);
}

async function resolvePublic(hostname, lookup) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  const list = Array.isArray(records) ? records : [records];
  if (!list.length || list.some((record) => isPrivateOrReservedIp(typeof record === 'string' ? record : record && record.address))) {
    throw new Error('blocked_address');
  }
  return list.map((record) => (typeof record === 'string' ? { address: record, family: net.isIP(record) } : record));
}

function validateUrl(value, kind) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  if (/^[a-z]+:\/\/[^/?#]*:/i.test(String(value)) || !isHostAllowed(url.hostname, kind)) return null;
  url.hash = '';
  return url;
}

// Default transport pins the socket to addresses that passed the private-range check (DNS rebinding guard).
function pinnedFetch(lookup) {
  return (url, { signal } = {}) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(target, {
      method: 'GET', signal, headers: { Accept: 'text/html,text/plain;q=0.9', 'User-Agent': 'ReadySetJob-Verifier/1.0' },
      lookup: (host, options, done) => resolvePublic(host, lookup)
        .then((records) => (options && options.all ? done(null, records) : done(null, records[0].address, records[0].family)))
        .catch(done),
    }, (res) => {
      const headers = new Headers();
      for (const [key, raw] of Object.entries(res.headers)) if (raw != null) headers.set(key, Array.isArray(raw) ? raw.join(', ') : String(raw));
      if (res.statusCode !== 200) {
        res.resume();
        resolve(new Response(null, { status: res.statusCode >= 200 && res.statusCode <= 599 ? res.statusCode : 502, headers }));
      } else {
        resolve(new Response(Readable.toWeb(res), { status: 200, headers }));
      }
    });
    req.on('error', reject);
    req.end();
  });
}

function extractVisibleText(html) {
  const stripped = String(html || '')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

function dateAppearsInText(text, isoDate) {
  const iso = normalizeDate(isoDate);
  if (!iso) return false;
  const [year, month, day] = iso.split('-').map(Number);
  const m = `0?${month}`;
  const d = `0?${day}`;
  const left = '(?<![0-9])';
  const right = '(?![0-9])';
  const full = [
    `${left}${year}\\s*[.\\-/]\\s*${m}\\s*[.\\-/]\\s*${d}${right}`,
    `${left}${year}\\s*년\\s*${m}\\s*월\\s*${d}\\s*일`,
  ];
  if (full.some((pattern) => new RegExp(pattern).test(text))) return true;
  const shortForms = [`${left}${m}\\s*월\\s*${d}\\s*일`, `${left}${m}\\s*[./]\\s*${d}\\s*\\(\\s*[월화수목금토일]\\s*\\)`];
  for (const pattern of shortForms) {
    for (const match of text.matchAll(new RegExp(pattern, 'g'))) {
      const context = text.slice(Math.max(0, match.index - 120), match.index);
      const years = [...context.matchAll(/(?<![0-9])((?:19|20|21)[0-9]{2})(?![0-9])/g)];
      if (years.length && Number(years[years.length - 1][1]) === year) return true;
    }
  }
  return false;
}

function titleKeywordsOverlap(title, text) {
  const haystack = String(text || '').toLowerCase().replace(/\s+/g, '');
  const tokens = [...new Set(String(title || '').toLowerCase().split(/[^0-9a-z가-힣]+/)
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !STOP_WORDS.has(token)))];
  if (!tokens.length) return false;
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  return matches >= Math.min(2, tokens.length);
}

async function fetchVerifiedPage(startUrl, kind, fetchFn, lookup, signal) {
  let url = validateUrl(startUrl, kind);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop += 1) {
    await resolvePublic(url.hostname, lookup);
    const response = await fetchFn(url.toString(), { method: 'GET', redirect: 'manual', signal, headers: { Accept: 'text/html,text/plain;q=0.9' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location) return { reason: 'redirect_without_location' };
      url = validateUrl(new URL(location, url).toString(), kind);
      if (!url) return { reason: 'redirect_not_allowed' };
      continue;
    }
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (response.status !== 200 || !['text/html', 'text/plain'].includes(type)) {
      await cancelBody(response);
      return { reason: response.status === 200 ? 'content_type_rejected' : 'http_status' };
    }
    return { body: await readCapped(response, MAX_VERIFY_BYTES), url: url.toString() };
  }
  return { reason: url ? 'too_many_redirects' : 'host_not_allowed' };
}

async function verifyCandidate(candidate = {}, options = {}) {
  const kind = options.kind;
  const keyDate = normalizeDate(candidate.apply_end) || normalizeDate(candidate.event_date);
  const url = candidate.source_url || candidate.url;
  if (!candidate.title || !keyDate) return { verified: false, reason: 'missing_required_fields' };
  if (!validateUrl(url, kind)) return { verified: false, reason: 'host_not_allowed' };
  const lookup = options.dnsLookupImpl || lookupOverride || dns.promises.lookup;
  const fetchFn = options.fetchImpl || fetchOverride || pinnedFetch(lookup);
  try {
    const page = await withDeadline((signal) => fetchVerifiedPage(url, kind, fetchFn, lookup, signal), options.timeoutMs || VERIFY_TIMEOUT_MS);
    if (!page.body) return { verified: false, reason: page.reason };
    const text = extractVisibleText(page.body);
    if (!titleKeywordsOverlap(candidate.title, text)) return { verified: false, reason: 'title_keyword_mismatch' };
    if (!dateAppearsInText(text, keyDate)) return { verified: false, reason: 'date_not_found_in_text' };
    return { verified: true, finalUrl: page.url };
  } catch (error) {
    return { verified: false, reason: error && error.code === 'size' ? 'too_large' : error && error.code === 'timeout' ? 'timeout' : 'fetch_rejected_or_failed' };
  }
}

module.exports = {
  VERIFY_TIMEOUT_MS, MAX_VERIFY_BYTES, MAX_REDIRECTS, PUBLIC_SUFFIXES, PRIVATE_CERT_HOSTS, BLOCKED_HOSTS,
  setVerifierFetchImpl, setDnsLookupImpl, isHostAllowed, isPrivateOrReservedIp, extractVisibleText,
  dateAppearsInText, titleKeywordsOverlap, verifyCandidate,
};
