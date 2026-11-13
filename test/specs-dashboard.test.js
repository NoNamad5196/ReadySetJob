const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { createSpecItem } = require('../src/services/specsService');

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('Specs dashboard widget and watch subscriptions', () => {
  let ctx;
  let userA;
  let userB;
  let uidA;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'specdash_a@readysetjob.dev', password: 'passwordA123!', name: '대시A' });
    userB = await signupAndLogin(ctx.app, { email: 'specdash_b@readysetjob.dev', password: 'passwordB123!', name: '대시B' });
    uidA = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get('specdash_a@readysetjob.dev').id;
  });

  after(() => ctx.cleanup());

  it('shows up to five upcoming 접수·시험 dates within 14 days and highlights the next 3 days', async () => {
    const empty = await userA.agent.get('/dashboard');
    assert.equal(empty.status, 200);
    assert.match(empty.text, /다가오는 시험·접수 마감/);
    assert.match(empty.text, /14일 이내 예정된 접수·시험 일정이 없습니다/);

    const urgent = createSpecItem(ctx.db, uidA, { kind: 'certificate', title: 'SQLD 52회', apply_end: dayOffset(2), event_date: dayOffset(12) });
    createSpecItem(ctx.db, uidA, { kind: 'contest', title: '공공데이터 공모전', apply_end: dayOffset(8) });
    createSpecItem(ctx.db, uidA, { kind: 'bootcamp', title: '먼 미래 부트캠프', apply_end: dayOffset(30) });
    createSpecItem(ctx.db, uidA, { kind: 'activity', title: '중단한 서포터즈', status: 'dropped', apply_end: dayOffset(4) });
    for (let i = 0; i < 4; i += 1) {
      createSpecItem(ctx.db, uidA, { kind: 'certificate', title: `추가 자격증 ${i}`, event_date: dayOffset(10 + i) });
    }

    const res = await userA.agent.get('/dashboard');
    assert.equal(res.status, 200);
    const widget = res.text.slice(res.text.indexOf('id="spec-upcoming-title"'), res.text.indexOf('class="interview-callout"'));
    const rows = widget.match(/class="spec-upcoming__item/g) || [];
    assert.equal(rows.length, 5);
    assert.match(widget, new RegExp(`href="/specs/${urgent.id}" class="spec-upcoming__item spec-upcoming__item--urgent"`));
    assert.match(widget, /SQLD 52회/);
    assert.match(widget, /접수 마감/);
    assert.match(widget, /D-2/);
    assert.ok(!widget.includes('먼 미래 부트캠프'));
    assert.ok(!widget.includes('중단한 서포터즈'));
    assert.ok(!widget.includes('추가 자격증 3'), 'sixth date must be cut by the limit');

    const other = await userB.agent.get('/dashboard');
    assert.ok(!other.text.includes('SQLD 52회'));
  });

  it('adds, deduplicates, validates and removes watch subscriptions per user', async () => {
    const add = await userA.agent.post('/specs/watch').type('form').send({ _csrf: userA.csrfToken, cert_code: '1320', cert_name: '정보처리기사' });
    assert.equal(add.status, 302);
    assert.equal(add.headers.location, '/specs');
    let page = await userA.agent.get('/specs');
    assert.match(page.text, /관심 자격증 구독을 추가했습니다/);
    assert.match(page.text, /spec-watch__name">정보처리기사/);

    const dup = await userA.agent.post('/specs/watch').type('form').send({ _csrf: userA.csrfToken, cert_code: '1320', cert_name: '정보처리기사' });
    assert.equal(dup.status, 302);
    page = await userA.agent.get('/specs');
    assert.match(page.text, /이미 구독 중인 자격증입니다/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM spec_watch WHERE user_id = ?').get(uidA).c, 1);

    const invalid = await userA.agent.post('/specs/watch').type('form').send({ _csrf: userA.csrfToken, cert_code: '1 3 2 0', cert_name: '' });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /자격증 코드는/);

    const noCsrf = await userA.agent.post('/specs/watch').type('form').send({ cert_code: '2290', cert_name: 'SQLD' });
    assert.equal(noCsrf.status, 403);

    const foreign = await userB.agent.post('/specs/watch/1320?_method=DELETE').type('form').send({ _csrf: userB.csrfToken, _method: 'DELETE' });
    assert.equal(foreign.status, 404);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM spec_watch WHERE user_id = ?').get(uidA).c, 1);

    const remove = await userA.agent.post('/specs/watch/1320?_method=DELETE').type('form').send({ _csrf: userA.csrfToken, _method: 'DELETE' });
    assert.equal(remove.status, 302);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM spec_watch WHERE user_id = ?').get(uidA).c, 0);
  });

  it('completing a spec over HTTP links a single material and shows the 자료함 link', async () => {
    const item = createSpecItem(ctx.db, uidA, { kind: 'contest', title: '해커톤 대상', organizer: '과기정통부' });
    for (const status of ['passed', 'completed', 'passed']) {
      const res = await userA.agent.post(`/specs/${item.id}/status`).type('form').send({ _csrf: userA.csrfToken, status });
      assert.equal(res.status, 302);
    }
    const mats = ctx.db.prepare("SELECT id, kind, tags FROM materials WHERE user_id = ? AND title = '해커톤 대상'").all(uidA);
    assert.equal(mats.length, 1);
    assert.equal(mats[0].kind, 'award');
    const detail = await userA.agent.get(`/specs/${item.id}`);
    assert.match(detail.text, new RegExp(`href="/materials/${mats[0].id}"[^>]*>경험 자료함에서 보기`));
  });
});
