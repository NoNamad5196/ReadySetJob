const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const request = require('supertest');
const { createTestContext, fetchCsrfToken, signupAndLogin } = require('./helpers');
const { migrate, hasColumn } = require('../src/db/migrate');

const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;
const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeJpegDataUrl(byteSize) {
  const buf = Buffer.alloc(byteSize, 0xab);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function findSessionCookie(res) {
  const cookies = res.headers['set-cookie'] || [];
  return cookies.find((c) => c.startsWith('readysetjob.sid=')) || '';
}

function parseCookieExpiresMs(cookieStr) {
  const match = String(cookieStr).match(/Expires=([^;]+)/i);
  if (!match) return null;
  const ts = Date.parse(match[1]);
  return Number.isNaN(ts) ? null : ts;
}

describe('Account Features (Track B): Remember-Me Login, ReturnTo & Profile Avatar', () => {
  let ctx;
  const email = 'remember@readysetjob.dev';
  const password = 'password123!';

  before(async () => {
    ctx = createTestContext();
    const { agent, csrfToken } = await signupAndLogin(ctx.app, { email, password, name: '유지테스터' });
    await agent.post('/logout').type('form').send({ _csrf: csrfToken });
  });

  after(() => {
    ctx.cleanup();
  });

  it('renders the remember-me checkbox on GET /login', async () => {
    // Given an unauthenticated client
    // When requesting GET /login
    const res = await request(ctx.app).get('/login');

    // Then the login form includes the remember_me checkbox and Korean label
    assert.equal(res.status, 200);
    assert.match(res.text, /type="checkbox"[^>]*name="remember_me"|name="remember_me"[^>]*type="checkbox"/i);
    assert.match(res.text, /로그인 상태 유지/);
  });

  it('keeps default 7-day cookie maxAge when remember_me is unchecked', async () => {
    // Given a registered user logging in without checking remember_me
    const agent = request.agent(ctx.app);
    const csrf = await fetchCsrfToken(agent, '/login');
    const beforeMs = Date.now();

    // When submitting POST /login without remember_me
    const loginRes = await agent.post('/login').type('form').send({ _csrf: csrf, email, password });

    // Then session cookie expires in ~7 days (not 30 days)
    assert.equal(loginRes.status, 302);
    assert.equal(loginRes.headers.location, '/dashboard');
    const sidCookie = findSessionCookie(loginRes);
    assert.ok(sidCookie);
    assert.match(sidCookie, /HttpOnly/i);
    assert.match(sidCookie, /SameSite=Lax/i);

    const expiresMs = parseCookieExpiresMs(sidCookie);
    assert.ok(expiresMs !== null);
    const deltaMs = expiresMs - beforeMs;
    assert.ok(deltaMs > SEVEN_DAYS_MS - 60000 && deltaMs <= SEVEN_DAYS_MS + 60000);
  });

  it('extends session cookie maxAge to 30 days (rolling) and regenerates session when remember_me is checked', async () => {
    // Given a client with a pre-login session cookie
    const agent = request.agent(ctx.app);
    const loginPageRes = await agent.get('/login');
    const preLoginCookie = findSessionCookie(loginPageRes);
    const csrf = loginPageRes.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
    const beforeMs = Date.now();

    // When submitting POST /login with remember_me='1'
    const loginRes = await agent.post('/login').type('form').send({ _csrf: csrf, email, password, remember_me: '1' });

    // Then session is regenerated and cookie maxAge is 30 days
    assert.equal(loginRes.status, 302);
    const postLoginCookie = findSessionCookie(loginRes);
    assert.ok(postLoginCookie);
    if (preLoginCookie) {
      assert.notEqual(preLoginCookie.split(';')[0], postLoginCookie.split(';')[0]);
    }

    const expiresMs = parseCookieExpiresMs(postLoginCookie);
    assert.ok(expiresMs !== null);
    const deltaMs = expiresMs - beforeMs;
    assert.ok(deltaMs > THIRTY_DAYS_MS - 60000 && deltaMs <= THIRTY_DAYS_MS + 60000);

    const sessRow = ctx.db.prepare('SELECT sess FROM sessions ORDER BY expire DESC LIMIT 1').get();
    assert.ok(sessRow);
    const parsedSess = JSON.parse(sessRow.sess);
    assert.equal(parsedSess.cookie.originalMaxAge, THIRTY_DAYS_MS);
    assert.equal(parsedSess.rememberMe, true);

    // When making a subsequent authenticated request (rolling behavior)
    const dashRes = await agent.get('/dashboard');
    assert.equal(dashRes.status, 200);
    const rolledCookie = findSessionCookie(dashRes);
    assert.ok(rolledCookie);
    assert.ok(parseCookieExpiresMs(rolledCookie) >= expiresMs);
  });

  it('redirects back to the originally requested protected page after login and blocks open redirects', async () => {
    // Given an unauthenticated user trying to access /companies
    const agent = request.agent(ctx.app);
    const protectedRes = await agent.get('/companies');
    assert.equal(protectedRes.status, 302);
    assert.equal(protectedRes.headers.location, '/login');

    // When the user logs in on that session
    const csrf = await fetchCsrfToken(agent, '/login');
    const loginRes = await agent.post('/login').type('form').send({ _csrf: csrf, email, password });

    // Then login redirects to /companies instead of /dashboard
    assert.equal(loginRes.status, 302);
    assert.equal(loginRes.headers.location, '/companies');

    // Given an unauthenticated user passing an external returnTo URL
    const evilAgent = request.agent(ctx.app);
    const evilCsrf = await fetchCsrfToken(evilAgent, '/login?returnTo=https://evil.example/phish');
    const evilLoginRes = await evilAgent.post('/login').type('form').send({
      _csrf: evilCsrf,
      email,
      password,
      returnTo: 'https://evil.example/phish',
    });

    // Then open redirect is blocked and falls back to /dashboard
    assert.equal(evilLoginRes.status, 302);
    assert.equal(evilLoginRes.headers.location, '/dashboard');
  });

  it('migrates users.avatar_data idempotently when run twice on an existing DB', () => {
    // Given an existing legacy DB without avatar_data column
    const legacyDb = new Database(':memory:');
    legacyDb.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT (datetime('now')));"
    );
    assert.equal(hasColumn(legacyDb, 'users', 'avatar_data'), false);

    // When migrate is executed twice
    migrate(legacyDb);
    migrate(legacyDb);

    // Then avatar_data column exists and migration succeeds idempotently
    assert.equal(hasColumn(legacyDb, 'users', 'avatar_data'), true);
    legacyDb.close();
  });

  it('requires authentication and CSRF token for avatar upload and removal', async () => {
    // Given an unauthenticated client with a valid session CSRF token
    const unauthAgent = request.agent(ctx.app);
    const unauthCsrf = await fetchCsrfToken(unauthAgent, '/login');

    // When posting to /settings/avatar and /settings/avatar/delete
    const unauthUpload = await unauthAgent.post('/settings/avatar').type('form').send({ _csrf: unauthCsrf, avatar_data: TINY_PNG_DATA_URL });
    assert.equal(unauthUpload.status, 302);
    assert.equal(unauthUpload.headers.location, '/login');

    const unauthDelete = await unauthAgent.post('/settings/avatar/delete').type('form').send({ _csrf: unauthCsrf });
    assert.equal(unauthDelete.status, 302);
    assert.equal(unauthDelete.headers.location, '/login');

    // Given an authenticated user without CSRF token
    const user = await signupAndLogin(ctx.app, { email: 'avatar_csrf@readysetjob.dev', password: 'password123!', name: '보안유저' });
    const noCsrfRes = await user.agent.post('/settings/avatar').type('form').send({ avatar_data: TINY_PNG_DATA_URL });
    assert.equal(noCsrfRes.status, 403);
  });

  it('rejects SVG, non-image, malformed, and oversized (>200KB) avatar uploads', async () => {
    // Given an authenticated user
    const user = await signupAndLogin(ctx.app, { email: 'avatar_invalid@readysetjob.dev', password: 'password123!', name: '검증유저' });

    // When uploading SVG or disguised SVG or non-image or oversized (>200KB) data URLs
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')}`;
    const disguisedSvg = `data:image/png;base64,${Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}`;
    const oversizedJpeg = makeJpegDataUrl(205 * 1024);

    for (const badPayload of [svgDataUrl, disguisedSvg, 'data:text/plain;base64,SGVsbG8=', 'https://example.com/avatar.png', oversizedJpeg]) {
      const res = await user.agent.post('/settings/avatar').type('form').send({ _csrf: user.csrfToken, avatar_data: badPayload });
      assert.equal(res.status, 422);
    }

    // Then avatar_data remains null
    const row = ctx.db.prepare('SELECT avatar_data FROM users WHERE email = ?').get('avatar_invalid@readysetjob.dev');
    assert.equal(row.avatar_data, null);
  });

  it('accepts valid PNG and ~120KB JPEG data URLs, renders avatar in layout and settings, scopes by user, and removes avatar', async () => {
    // Given two authenticated users A and B
    const userA = await signupAndLogin(ctx.app, { email: 'avatar_a@readysetjob.dev', password: 'password123!', name: '김프로필' });
    const userB = await signupAndLogin(ctx.app, { email: 'avatar_b@readysetjob.dev', password: 'password123!', name: '박타인' });

    // When user A uploads a valid small PNG data URL
    const pngRes = await userA.agent.post('/settings/avatar').type('form').send({ _csrf: userA.csrfToken, avatar_data: TINY_PNG_DATA_URL });
    assert.equal(pngRes.status, 302);
    assert.equal(pngRes.headers.location, '/settings');
    assert.equal(ctx.db.prepare('SELECT avatar_data FROM users WHERE email = ?').get('avatar_a@readysetjob.dev').avatar_data, TINY_PNG_DATA_URL);

    // When user A uploads a ~120KB decoded JPEG data URL (~160KB base64, testing >100KB route body limit)
    const mediumJpeg = makeJpegDataUrl(120 * 1024);
    const jpegRes = await userA.agent.post('/settings/avatar').type('form').send({ _csrf: userA.csrfToken, avatar_data: mediumJpeg });
    assert.equal(jpegRes.status, 302);

    // Then GET /settings and GET /dashboard render user A's avatar image while user B stays isolated
    const settingsRes = await userA.agent.get('/settings');
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.text.includes(mediumJpeg), true);

    const dashARes = await userA.agent.get('/dashboard');
    assert.equal(dashARes.status, 200);
    assert.equal(dashARes.text.includes(mediumJpeg), true);

    assert.equal(ctx.db.prepare('SELECT avatar_data FROM users WHERE email = ?').get('avatar_b@readysetjob.dev').avatar_data, null);
    assert.equal((await userB.agent.get('/dashboard')).text.includes(mediumJpeg), false);

    // When user A removes their profile photo
    const removeRes = await userA.agent.post('/settings/avatar/delete').type('form').send({ _csrf: userA.csrfToken });
    assert.equal(removeRes.status, 302);
    assert.equal(removeRes.headers.location, '/settings');

    // Then avatar_data is NULL in DB and UI falls back to initial avatar
    assert.equal(ctx.db.prepare('SELECT avatar_data FROM users WHERE email = ?').get('avatar_a@readysetjob.dev').avatar_data, null);
    const dashAfterRemove = await userA.agent.get('/dashboard');
    assert.equal(dashAfterRemove.text.includes(mediumJpeg), false);
    assert.match(dashAfterRemove.text, /김/);
  });
});
