const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, signupAndLogin } = require('./helpers');
const logo = require('../src/services/logoService');

function png(size, extra = 200) {
  const buf = Buffer.alloc(24 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(size, 16);
  buf.writeUInt32BE(size, 20);
  return buf;
}

function reply(status, body, contentType = 'image/png', headers = {}) {
  return new Response(body, { status, headers: { 'content-type': contentType, ...headers } });
}

describe('Company logos', () => {
  let ctx;
  let userA;
  let userB;
  let calls;
  let handler;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'logo_a@readysetjob.dev', password: 'passwordA123!', name: '로고A' });
    userB = await signupAndLogin(ctx.app, { email: 'logo_b@readysetjob.dev', password: 'passwordB123!', name: '로고B' });
    const idA = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get('logo_a@readysetjob.dev').id;
    const insert = ctx.db.prepare('INSERT INTO companies (user_id, name, website) VALUES (?, ?, ?)');
    insert.run(idA, '토스', 'https://toss.im/career');
    insert.run(idA, '카카오', 'https://careers.kakao.com');
    insert.run(idA, '무웹사이트', '');
    logo.setLogoFetchImpl(async (url, opts) => {
      calls.push(url);
      assert.equal(opts.redirect, 'manual');
      return handler(url);
    });
  });

  beforeEach(() => {
    calls = [];
    handler = () => reply(200, png(128));
    ctx.db.prepare('DELETE FROM company_logos').run();
  });

  after(() => {
    logo.setLogoFetchImpl(null);
    ctx.cleanup();
  });

  it('normalizes career/recruit subdomains to the registrable domain', () => {
    assert.equal(logo.normalizeDomain('https://careers.kakao.com'), 'kakao.com');
    assert.equal(logo.normalizeDomain('https://recruit.navercorp.com/rcrt/list.do'), 'navercorp.com');
    assert.equal(logo.normalizeDomain('https://toss.im/career'), 'toss.im');
    assert.equal(logo.normalizeDomain('WWW.Coupang.Jobs'), 'coupang.jobs');
    assert.equal(logo.normalizeDomain('https://career.woowahan.com'), 'woowahan.com');
    assert.equal(logo.normalizeDomain('https://co.kr'), null);
    assert.equal(logo.normalizeDomain('https://www.daum.co.kr'), 'daum.co.kr');
    assert.equal(logo.normalizeDomain('https://recruit.samsung.co.kr'), 'samsung.co.kr');
  });

  it('rejects IPs, localhost, ports, credentials and non-http schemes', () => {
    for (const bad of [
      'http://127.0.0.1', 'http://10.0.0.5/x', 'http://[::1]/', 'http://0x7f.1', 'http://localhost:3000',
      'http://foo.localhost', 'https://kakao.com:8443', 'https://user:pw@kakao.com', 'file:///etc/passwd',
      'javascript:alert(1)', '', 'not a url at all',
    ]) {
      assert.equal(logo.normalizeDomain(bad), null, bad);
    }
  });

  it('ignores job board / aggregator hosts for discover URLs', () => {
    assert.equal(logo.domainFromSourceUrl('https://www.saramin.co.kr/zf_user/jobs/view?id=1'), null);
    assert.equal(logo.domainFromSourceUrl('https://blog.naver.com/someone/1'), null);
    assert.equal(logo.domainFromSourceUrl('https://kr.linkedin.com/jobs/view/1'), null);
    assert.equal(logo.domainFromSourceUrl('https://www.wanted.co.kr/wd/1'), null);
    assert.equal(logo.domainFromSourceUrl('https://careers.kakao.com/jobs/P-1'), 'kakao.com');
  });

  it('only fetches the fixed favicon services and follows only gstatic redirects', async () => {
    assert.equal(logo.isAllowedFetchUrl('https://kakao.com/favicon.ico'), false);
    assert.equal(logo.isAllowedFetchUrl('http://www.google.com/s2/favicons'), false);
    assert.equal(logo.isAllowedFetchUrl('https://t3.gstatic.com/faviconV2?url=x'), true);
    handler = (url) => (url.startsWith('https://www.google.com/')
      ? reply(301, '', 'text/html', { location: 'http://169.254.169.254/latest' })
      : reply(200, png(64)));
    const result = await logo.getLogoForDomain(ctx.db, 'kakao.com');
    assert.ok(result);
    assert.deepEqual(calls, [
      'https://www.google.com/s2/favicons?domain=kakao.com&sz=128',
      'https://icons.duckduckgo.com/ip3/kakao.com.ico',
    ]);
  });

  it('rejects SVG/HTML even when content-type claims an image, and tiny globe icons', async () => {
    assert.equal(logo.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(100))), null);
    handler = (url) => (url.includes('google')
      ? reply(200, Buffer.from('<html><body>hi</body></html>'.padEnd(200)), 'image/png')
      : reply(200, Buffer.from('<svg/>'.padEnd(200)), 'image/svg+xml'));
    assert.equal(await logo.getLogoForDomain(ctx.db, 'evil.example'), null);
    handler = (url) => (url.includes('google') ? reply(404, png(16)) : reply(200, png(16)));
    assert.equal(await logo.getLogoForDomain(ctx.db, 'globe.example'), null);
    const row = ctx.db.prepare('SELECT status FROM company_logos WHERE domain = ?').get('globe.example');
    assert.equal(row.status, 'missing');
  });

  it('caches results and de-duplicates concurrent fetches', async () => {
    const [a, b] = await Promise.all([
      logo.getLogoForDomain(ctx.db, 'toss.im'),
      logo.getLogoForDomain(ctx.db, 'toss.im'),
    ]);
    assert.ok(a && b);
    assert.equal(calls.length, 1);
    await logo.getLogoForDomain(ctx.db, 'toss.im');
    assert.equal(calls.length, 1);
  });

  it('serves logo bytes with safe headers for an owned company', async () => {
    const res = await userA.agent.get('/logos/company?name=' + encodeURIComponent('카카오')).buffer(true);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['cache-control'], 'private, max-age=86400');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.body.length, png(128).length);
    assert.equal(calls[0], 'https://www.google.com/s2/favicons?domain=kakao.com&sz=128');
  });

  it('returns a transparent PNG (200) for missing logos and upstream failures', async () => {
    const res1 = await userA.agent.get('/logos/company?name=' + encodeURIComponent('무웹사이트')).buffer(true);
    assert.equal(res1.status, 200);
    assert.ok(Buffer.from(res1.body).equals(logo.TRANSPARENT_PNG));
    assert.equal(calls.length, 0);
    handler = () => { throw new Error('network down'); };
    const res2 = await userA.agent.get('/logos/company?name=' + encodeURIComponent('토스')).buffer(true);
    assert.equal(res2.status, 200);
    assert.ok(Buffer.from(res2.body).equals(logo.TRANSPARENT_PNG));
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM company_logos').get().c, 0, 'transient errors are not cached');
  });

  it('does not resolve another user\'s company website by name', async () => {
    const res = await userB.agent.get('/logos/company?name=' + encodeURIComponent('토스')).buffer(true);
    assert.equal(res.status, 200);
    assert.ok(Buffer.from(res.body).equals(logo.TRANSPARENT_PNG));
    assert.equal(calls.length, 0);
  });

  it('uses a non-aggregator discover URL and falls back to name lookup otherwise', async () => {
    await userB.agent.get('/logos/company?name=X&url=' + encodeURIComponent('https://careers.linecorp.com/jobs/1'));
    assert.equal(calls[0], 'https://www.google.com/s2/favicons?domain=linecorp.com&sz=128');
    calls = [];
    const res = await userB.agent.get('/logos/company?name=X&url=' + encodeURIComponent('https://www.saramin.co.kr/x')).buffer(true);
    assert.ok(Buffer.from(res.body).equals(logo.TRANSPARENT_PNG));
    assert.equal(calls.length, 0);
  });

  it('requires authentication', async () => {
    const res = await request(ctx.app).get('/logos/company?name=x');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
  });

  it('renders avatar__logo images for companies', async () => {
    const res = await userA.agent.get('/companies');
    assert.equal(res.status, 200);
    const expected = '/logos/company?name=' + encodeURIComponent('카카오');
    assert.ok(res.text.includes(`<img class="avatar__logo" src="${expected}" alt="" loading="lazy" decoding="async">`));
  });
});
