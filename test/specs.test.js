const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, signupAndLogin } = require('./helpers');
const { createSpecItem } = require('../src/services/specsService');

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const FORM = {
  kind: 'certificate',
  title: '정보처리기사 필기',
  organizer: '한국산업인력공단',
  status: 'interested',
  apply_start: dayOffset(-1),
  apply_end: dayOffset(5),
  event_date: dayOffset(20),
  result_date: dayOffset(40),
  source_url: 'https://www.q-net.or.kr',
  memo: '필기 4회차',
};

describe('Specs routes (/specs) CRUD, validation, ownership, CSRF', () => {
  let ctx;
  let userA;
  let userB;
  let specId;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'specs_a@readysetjob.dev', password: 'passwordA123!', name: '스펙A' });
    userB = await signupAndLogin(ctx.app, { email: 'specs_b@readysetjob.dev', password: 'passwordB123!', name: '스펙B' });
  });

  after(() => ctx.cleanup());

  it('redirects anonymous users to /login and rejects anonymous API calls', async () => {
    const page = await request(ctx.app).get('/specs');
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, '/login');
    const api = await request(ctx.app).patch('/api/specs/1/status').send({ status: 'applied' });
    assert.equal(api.status, 403);
    assert.equal(api.body.error, '유효하지 않은 CSRF 토큰입니다.');
  });

  it('GET /specs/new renders the create form and marks the sidebar item active', async () => {
    const res = await userA.agent.get('/specs/new');
    assert.equal(res.status, 200);
    assert.match(res.text, /스펙 등록/);
    assert.match(res.text, /name="title"/);
    assert.match(res.text, /name="_csrf"/);
    assert.match(res.text, /href="\/specs" class="sidebar__link sidebar__link--active"/);
  });

  it('POST /specs creates an item and redirects to its detail with an automation flash', async () => {
    const res = await userA.agent.post('/specs').type('form').send({ _csrf: userA.csrfToken, ...FORM });
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/specs\/\d+$/);
    specId = Number(res.headers.location.split('/').pop());

    const detail = await userA.agent.get(`/specs/${specId}`);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /스펙이 등록되었습니다/);
    assert.match(detail.text, /자동으로 등록되었습니다/);
    assert.match(detail.text, /일정 타임라인/);
    assert.match(detail.text, /\[정보처리기사 필기\] 접수 마감/);
    assert.match(detail.text, /\[정보처리기사 필기\] 원서 접수/);
    assert.match(detail.text, /직접 입력/);
    assert.match(detail.text, /경험 자료함/);
  });

  it('POST /specs rejects invalid input with a 422 re-render', async () => {
    const cases = [
      [{ title: '   ' }, /제목을 입력해 주세요/],
      [{ title: 'x'.repeat(201) }, /200자 이하/],
      [{ kind: 'hobby' }, /스펙 종류/],
      [{ apply_end: '2026-02-30' }, /날짜 형식/],
      [{ apply_start: dayOffset(10), apply_end: dayOffset(1) }, /접수 시작일은/],
      [{ source_url: 'javascript:alert(1)' }, /https:\/\//],
    ];
    for (const [override, pattern] of cases) {
      const res = await userA.agent.post('/specs').type('form').send({ _csrf: userA.csrfToken, ...FORM, ...override });
      assert.equal(res.status, 422, JSON.stringify(override));
      assert.match(res.text, pattern);
    }
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM spec_items').get().c, 1);
  });

  it('rejects state changes without a CSRF token (403)', async () => {
    assert.equal((await userA.agent.post('/specs').type('form').send(FORM)).status, 403);
    assert.equal((await userA.agent.post(`/specs/${specId}/status`).type('form').send({ status: 'applied' })).status, 403);
    assert.equal((await userA.agent.patch(`/api/specs/${specId}/status`).send({ status: 'applied' })).status, 403);
    const del = await userA.agent.post(`/specs/${specId}?_method=DELETE`).type('form').send({ _method: 'DELETE' });
    assert.equal(del.status, 403);
  });

  it("returns 404 when another user touches someone else's spec", async () => {
    const csrf = userB.csrfToken;
    assert.equal((await userB.agent.get(`/specs/${specId}`)).status, 404);
    assert.equal((await userB.agent.get(`/specs/${specId}/edit`)).status, 404);
    const put = await userB.agent.post(`/specs/${specId}?_method=PUT`).type('form').send({ _csrf: csrf, _method: 'PUT', ...FORM, title: '탈취' });
    assert.equal(put.status, 404);
    const status = await userB.agent.post(`/specs/${specId}/status`).type('form').send({ _csrf: csrf, status: 'dropped' });
    assert.equal(status.status, 404);
    const api = await userB.agent.patch(`/api/specs/${specId}/status`).set('X-CSRF-Token', csrf).send({ status: 'nope' });
    assert.equal(api.status, 404);
    const del = await userB.agent.post(`/specs/${specId}?_method=DELETE`).type('form').send({ _csrf: csrf, _method: 'DELETE' });
    assert.equal(del.status, 404);
    assert.equal((await userB.agent.get('/specs/not-a-number')).status, 404);

    const row = ctx.db.prepare('SELECT title, status FROM spec_items WHERE id = ?').get(specId);
    assert.deepEqual({ ...row }, { title: '정보처리기사 필기', status: 'interested' });
    assert.ok(!(await userB.agent.get('/specs')).text.includes('정보처리기사 필기'));
  });

  it('PUT /specs/:id updates fields, escapes output, and re-renders 422 on invalid edits', async () => {
    const edit = await userA.agent.get(`/specs/${specId}/edit`);
    assert.equal(edit.status, 200);
    assert.match(edit.text, /value="정보처리기사 필기"/);

    const bad = await userA.agent.post(`/specs/${specId}?_method=PUT`).type('form').send({ _csrf: userA.csrfToken, _method: 'PUT', ...FORM, title: '' });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /제목을 입력해 주세요/);

    const ok = await userA.agent.post(`/specs/${specId}?_method=PUT`).type('form').send({ _csrf: userA.csrfToken, _method: 'PUT', ...FORM, memo: '수정된 메모 <b>' });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.location, `/specs/${specId}`);
    const detail = await userA.agent.get(`/specs/${specId}`);
    assert.match(detail.text, /수정된 메모 &lt;b&gt;/);
    assert.ok(!detail.text.includes('수정된 메모 <b>'));
  });

  it('POST /specs/:id/status (no-JS) and PATCH /api/specs/:id/status (JSON) change status', async () => {
    const form = await userA.agent.post(`/specs/${specId}/status`).type('form').send({ _csrf: userA.csrfToken, status: 'applied', redirect_to: '/specs' });
    assert.equal(form.status, 302);
    assert.equal(form.headers.location, '/specs');

    const api = await userA.agent.patch(`/api/specs/${specId}/status`).set('X-CSRF-Token', userA.csrfToken).send({ status: 'in_progress' });
    assert.equal(api.status, 200);
    assert.equal(api.body.ok, true);
    assert.equal(api.body.spec.status, 'in_progress');

    const invalid = await userA.agent.patch(`/api/specs/${specId}/status`).set('X-CSRF-Token', userA.csrfToken).send({ status: 'nope' });
    assert.equal(invalid.status, 422);
    const invalidForm = await userA.agent.post(`/specs/${specId}/status`).type('form').send({ _csrf: userA.csrfToken, status: 'nope' });
    assert.equal(invalidForm.status, 422);
    assert.match(invalidForm.text, /class="spec-status-picker"/);
  });

  it('GET /specs renders the five status columns, badges, list view and filters', async () => {
    const uid = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get('specs_a@readysetjob.dev').id;
    createSpecItem(ctx.db, uid, { kind: 'bootcamp', title: 'K-디지털 트레이닝 웹 풀스택', source: 'work24', source_ref: 'W-1', apply_end: dayOffset(9) });

    const board = await userA.agent.get('/specs');
    assert.equal(board.status, 200);
    for (const label of ['관심', '신청·접수', '진행·응시', '완료·합격', '불합격·중단']) {
      assert.ok(board.text.includes(label), `missing column ${label}`);
    }
    assert.match(board.text, /data-spec-id="\d+"/);
    assert.match(board.text, /spec-source--official"[^>]*>공식/);
    assert.match(board.text, /spec-source--manual"[^>]*>직접 입력/);
    assert.match(board.text, /D-9/);
    assert.match(board.text, /\/js\/specs\.js/);

    const list = await userA.agent.get('/specs?view=list');
    assert.equal(list.status, 200);
    assert.match(list.text, /class="table spec-table"/);
    assert.match(list.text, /K-디지털 트레이닝 웹 풀스택/);

    const cardTitles = (html) => [...html.matchAll(/class="(?:spec-card__title|cell-two-line__title)">([^<]+)</g)].map((m) => m[1].trim());
    const filtered = await userA.agent.get(`/specs?kind=bootcamp&q=${encodeURIComponent('풀스택')}`);
    assert.deepEqual(cardTitles(filtered.text), ['K-디지털 트레이닝 웹 풀스택']);
    const byStatus = await userA.agent.get('/specs?status=in_progress&view=list');
    assert.deepEqual(cardTitles(byStatus.text), ['정보처리기사 필기']);
  });

  it('DELETE /specs/:id removes the item with its auto events and todos', async () => {
    const res = await userA.agent.post(`/specs/${specId}?_method=DELETE`).type('form').send({ _csrf: userA.csrfToken, _method: 'DELETE' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/specs');
    assert.equal(ctx.db.prepare('SELECT id FROM spec_items WHERE id = ?').get(specId), undefined);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM events WHERE spec_item_id = ?').get(specId).c, 0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM todos WHERE spec_item_id = ?').get(specId).c, 0);
    assert.equal((await userA.agent.get(`/specs/${specId}`)).status, 404);
  });

  it('filters date windows and preserves them when switching views', async () => {
    // Given two specs whose dates fall in different windows.
    const uid = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get('specs_a@readysetjob.dev').id;
    createSpecItem(ctx.db, uid, { title: '기간 안 활동', event_date: '2031-04-12' });
    createSpecItem(ctx.db, uid, { title: '기간 밖 활동', event_date: '2031-05-12' });
    // When the board is filtered to April.
    const res = await userA.agent.get('/specs?from=2031-04-01&to=2031-04-30');
    // Then only matching cards render and the list toggle retains the window.
    assert.equal(res.status, 200);
    assert.match(res.text, /class="spec-card__title">기간 안 활동</);
    assert.doesNotMatch(res.text, /class="spec-card__title">기간 밖 활동</);
    assert.match(res.text, /href="\/specs\?view=list&amp;from=2031-04-01&amp;to=2031-04-30"/);
  });
});
