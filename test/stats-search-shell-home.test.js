const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');
const { computeConversionStats } = require('../src/services/statsService');
const { getShellData } = require('../src/middleware/shellData');
const { getDashboardHome } = require('../src/services/dashboardService');
const { companyAvatar } = require('../src/utils/avatar');

describe('Stats Pass-Rates, Interview Prep, Global Search, Shell Data, and Home Object', () => {
  let ctx;
  let userA;
  let userB;
  const fixedNow = new Date(2026, 10, 11, 12, 0, 0); // 2026-11-11

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'stats_a@readysetjob.dev',
      password: 'passwordA123!',
      name: '김선우',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'stats_b@readysetjob.dev',
      password: 'passwordB123!',
      name: '타유저B',
    });

    await userA.agent.post('/settings').type('form').send({
      _csrf: userA.csrfToken,
      name: '김선우',
      season_label: '2026 하반기 취업 준비',
      target: '20',
      month: '2026-11',
    });

    // Crafted dataset for User A:
    // 1. 토스: document (in_progress), applied 2026-11-05, deadline +2d, favorite=1
    // 2. 네이버: interview1 (in_progress), applied 2026-11-02, deadline +4d, favorite=1
    // 3. 카카오: coding_test (failed), applied 2026-11-01
    // 4. 라인플러스: final (passed), applied 2026-10-15
    // 5. 당근: document (failed), applied 2026-10-10
    // 6. 쿠팡: interview2 (in_progress, no event), applied 2026-11-08
    // Document stage decided: #2 (moved on), #3 (moved on), #4 (moved on), #6 (moved on), #5 (failed at document) => 4 movedPast / 5 decided = 80%
    // This month (2026-11): 4 apps (#1, #2, #3, #6); Last month (2026-10): 2 apps (#4, #5) => delta = +2
    const todayIso = new Date().toISOString().slice(0, 10);
    const plus2d = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const plus3d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

    const specs = [
      { comp: '토스', title: '토스 FE', pos: 'Frontend Engineer', stage: 'document', result: 'in_progress', applied: '2026-11-05', dl: plus2d, fav: true },
      { comp: '네이버', title: '네이버 FE', pos: 'FE 엔지니어', stage: 'interview1', result: 'in_progress', applied: '2026-11-02', dl: plus3d, fav: true },
      { comp: '카카오', title: '카카오 FE', pos: 'FE 개발자', stage: 'coding_test', result: 'failed', applied: '2026-11-01', dl: null, fav: false },
      { comp: '라인플러스', title: '라인 웹', pos: 'Web Engineer', stage: 'final', result: 'passed', applied: '2026-10-15', dl: null, fav: false },
      { comp: '당근', title: '당근 웹뷰', pos: 'FE Intern', stage: 'document', result: 'failed', applied: '2026-10-10', dl: null, fav: false },
      { comp: '쿠팡', title: '쿠팡 커머스_100%', pos: 'Front-end', stage: 'interview2', result: 'in_progress', applied: '2026-11-08', dl: null, fav: false },
    ];

    const appIds = [];
    for (const s of specs) {
      const jobRes = await userA.agent.post('/jobs').type('form').send({
        _csrf: userA.csrfToken,
        new_company_name: s.comp,
        title: s.title,
        position: s.pos,
        deadline: s.dl,
      });
      const jId = Number(jobRes.headers.location.split('/').pop());
      const appRes = await userA.agent.post('/applications').type('form').send({
        _csrf: userA.csrfToken,
        job_post_id: jId,
        stage: s.stage,
        result: s.result,
        applied_at: s.applied,
      });
      const aId = Number(appRes.headers.location.split('/').pop());
      appIds.push(aId);
      if (s.fav) {
        await userA.agent.post(`/applications/${aId}/favorite`).type('form').send({ _csrf: userA.csrfToken });
      }
    }

    // Add essay on 토스 (appIds[0]): 2 questions, 1 answered, 1 empty
    await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '토스 자소서',
      application_id: appIds[0],
      question: ['1번 질문', '2번 질문'],
      char_limit: ['1000', '1000'],
      answer: ['작성 완료 답변', ''],
    });

    // Add upcoming interview event on 네이버 (appIds[1]) and manual interview question
    await userA.agent.post('/events').type('form').send({
      _csrf: userA.csrfToken,
      application_id: appIds[1],
      title: '네이버 1차 기술면접',
      type: 'interview',
      starts_at: `${plus3d}T15:00`,
    });
    await userA.agent.post(`/applications/${appIds[1]}/interview-questions`).type('form').send({
      _csrf: userA.csrfToken,
      question: '네이버 렌더링 최적화 질문',
    });

    // Auto-organize (automationService) adds todos on application create/stage;
    // drop them so this fixture keeps exact todo counts (covered in automation.test.js).
    ctx.db.prepare('DELETE FROM todos WHERE user_id = 1').run();

    // Add open todo for today
    await userA.agent.post('/todos').type('form').send({
      _csrf: userA.csrfToken,
      title: '토스 자소서 2번 작성',
      category: 'essay',
      due_date: todayIso,
      application_id: appIds[0],
    });

    // User B creates a company & job that must not leak to User A
    await userB.agent.post('/jobs').type('form').send({
      _csrf: userB.csrfToken,
      new_company_name: '비밀기업B',
      title: '비밀공고B',
    });
  });

  after(() => {
    ctx.cleanup();
  });

  it('computes exact pass-rates, funnel counts, and month delta on the crafted dataset and renders GET /stats', async () => {
    const conv = computeConversionStats(ctx.db, 1, fixedNow);

    // Funnel reached counts:
    // document: all 6; coding_test: 4 (#2, #3, #4, #6); assignment: 3 (#2, #4, #6);
    // interview1: 3 (#2, #4, #6); interview2: 2 (#4, #6); final: 1 (#4)
    assert.deepEqual(conv.funnel.counts, [6, 4, 3, 3, 2, 1]);

    // Document pass rate: 4 moved on / (4 moved on + 1 failed at document) = 4 / 5 = 80%
    assert.equal(conv.documentStats.reached, 6);
    assert.equal(conv.documentStats.movedPast, 4);
    assert.equal(conv.documentStats.failed, 1);
    assert.equal(conv.documentStats.decided, 5);
    assert.equal(conv.documentPassRate, 80);

    // Final stage pass rate: 1 reached, 1 passed -> 100%
    assert.equal(conv.passRates.final.reached, 1);
    assert.equal(conv.passRates.final.movedPast, 1);
    assert.equal(conv.passRates.final.rate, 100);

    // Month comparison (2026-11 vs 2026-10): 4 vs 2 -> delta +2
    assert.equal(conv.thisMonthCount, 4);
    assert.equal(conv.lastMonthCount, 2);
    assert.equal(conv.monthDelta, 2);

    const statsPage = await userA.agent.get('/stats');
    assert.equal(statsPage.status, 200);
    assert.match(statsPage.text, /id="stats-data"/);
    assert.match(statsPage.text, /\/js\/stats\.js/);
    assert.match(statsPage.text, /80%/);
  });

  it('renders GET /interview-prep with upcoming interviews, questions, and unscheduled interview apps scoped to user', async () => {
    const res = await userA.agent.get('/interview-prep');
    assert.equal(res.status, 200);
    assert.match(res.text, /네이버 1차 기술면접/);
    assert.match(res.text, /네이버 렌더링 최적화 질문/);
    assert.match(res.text, /쿠팡/);
    assert.equal(res.text.includes('비밀기업B'), false);
  });

  it('scopes GET /search and GET /api/search to user and escapes LIKE wildcards', async () => {
    const htmlRes = await userA.agent.get('/search?q=' + encodeURIComponent('토스'));
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.text, /토스/);

    const apiRes = await userA.agent.get('/api/search?q=' + encodeURIComponent('토스'));
    assert.equal(apiRes.status, 200);
    assert.equal(apiRes.body.companies.length, 1);
    assert.equal(apiRes.body.jobs.length, 1);
    assert.equal(apiRes.body.applications.length, 1);
    assert.equal(apiRes.body.essays.length, 1);

    // User B's company is not visible to User A
    const leakRes = await userA.agent.get('/api/search?q=' + encodeURIComponent('비밀기업B'));
    assert.equal(leakRes.status, 200);
    assert.equal(leakRes.body.total, 0);

    // Wildcard '%' alone should NOT match everything when escaped
    const wildcardRes = await userA.agent.get('/api/search?q=' + encodeURIComponent('100%'));
    assert.equal(wildcardRes.status, 200);
    assert.equal(wildcardRes.body.jobs.length, 1);
    assert.match(wildcardRes.body.jobs[0].title, /쿠팡 커머스_100%/);

    const compSearchRes = await userA.agent.get('/api/search/companies?q=' + encodeURIComponent('라인'));
    assert.equal(compSearchRes.status, 200);
    assert.equal(compSearchRes.body.companies.length, 1);
    assert.equal(compSearchRes.body.companies[0].name, '라인플러스');
    assert.match(compSearchRes.body.companies[0].href, /^\/companies\/\d+$/);

    const leakCompRes = await userA.agent.get('/api/search/companies?q=' + encodeURIComponent('비밀기업B'));
    assert.equal(leakCompRes.status, 200);
    assert.equal(leakCompRes.body.companies.length, 0);

    assert.match(htmlRes.text, /id="quick-launch-search-input"/);
    assert.match(htmlRes.text, /id="global-search-results"/);
  });

  it('provides exact shell contract, companyAvatar helper, and dashboard home object', () => {
    const avatar1 = companyAvatar('토스');
    const avatar2 = companyAvatar('토스');
    assert.equal(avatar1.initial, '토');
    assert.equal(avatar1.index, avatar2.index);
    assert.ok(avatar1.index >= 0 && avatar1.index <= 7);

    const shell = getShellData(ctx.db, 1, fixedNow);
    assert.equal(shell.user.name, '김선우');
    assert.equal(shell.user.season_label, '2026 하반기 취업 준비');
    assert.equal(shell.counts.applications_in_progress, 3);
    assert.equal(shell.counts.todos_open, 1);
    assert.equal(shell.favorites.length, 2);
    assert.equal(shell.goal.month, '2026-11');
    assert.equal(shell.goal.label, '11월');
    assert.equal(shell.goal.target, 20);
    assert.equal(shell.goal.current, 4);
    assert.ok(Array.isArray(shell.notifications));
    assert.ok(shell.notifications.length >= 2);

    const home = getDashboardHome(ctx.db, 1);
    assert.ok(home.today.label.includes('월'));
    assert.ok(home.heroDeadline);
    assert.equal(home.heroDeadline.company, '토스');
    assert.deepEqual(
      { answered: home.heroDeadline.essayProgress.answered, total: home.heroDeadline.essayProgress.total },
      { answered: 1, total: 2 }
    );
    assert.equal(home.week.length, 7);
    assert.equal(home.inProgress.length, 3);
    assert.equal(home.todosToday.length, 1);
    assert.equal(home.todosToday.totalCount, 1);
    assert.ok(home.nextInterview);
    assert.equal(home.nextInterview.company, '네이버');
    assert.ok(Array.isArray(home.recent) && home.recent.length > 0);
    assert.equal(home.stats.total, 6);
    assert.equal(home.stats.documentPassRate, 80);
  });

  it('renders decluttered sidebar navigation with 3 groups and active states on merged sub-pages', async () => {
    const res = await userA.agent.get('/dashboard');
    assert.equal(res.status, 200);
    assert.match(res.text, /취업 활동/);
    assert.match(res.text, /서류·준비/);
    assert.match(res.text, /관리/);
    assert.match(res.text, /href="\/dashboard" class="sidebar__link sidebar__link--active"/);
    assert.match(res.text, /href="\/applications\/board"/);
    assert.match(res.text, /href="\/jobs"/);
    assert.match(res.text, /href="\/companies"/);
    assert.match(res.text, /href="\/essays"/);
    assert.match(res.text, /href="\/materials"/);
    assert.match(res.text, /href="\/interview-prep"/);
    assert.match(res.text, /href="\/events"/);
    assert.match(res.text, /href="\/specs"/);
    assert.match(res.text, /href="\/stats"/);

    const libraryRes = await userA.agent.get('/library');
    assert.match(libraryRes.text, /href="\/essays" class="sidebar__link sidebar__link--active"/);
    assert.match(libraryRes.text, /class="segmented-tab segmented-tab--active"[^>]*>자소서 라이브러리<\/a>/);

    const discoverRes = await userA.agent.get('/jobs/discover');
    assert.match(discoverRes.text, /href="\/jobs" class="sidebar__link sidebar__link--active"/);
    assert.match(discoverRes.text, /class="segmented-tab segmented-tab--active"[^>]*>AI 공고 찾기<\/a>/);

    const todosRes = await userA.agent.get('/todos');
    assert.match(todosRes.text, /href="\/events" class="sidebar__link sidebar__link--active"/);
    assert.match(todosRes.text, /class="segmented-tab segmented-tab--active"[^>]*>할 일<\/a>/);
  });
});
