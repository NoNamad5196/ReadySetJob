const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');

describe('Dashboard (/dashboard & /api/dashboard/stats)', () => {
  let ctx;
  let userA;
  let userB;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'dash_a@readysetjob.dev',
      password: 'passwordA123!',
      name: '대시보드A',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'dash_b@readysetjob.dev',
      password: 'passwordB123!',
      name: '대시보드B',
    });

    // User A: create companies, jobs, applications across stages & results
    const stagesAndResults = [
      { comp: '네이버', stage: 'document', result: 'in_progress', date: '2026-11-01', dl: '2026-11-15' },
      { comp: '카카오', stage: 'coding_test', result: 'in_progress', date: '2026-10-15', dl: '2026-11-20' },
      { comp: '라인', stage: 'interview1', result: 'passed', date: '2026-09-10', dl: null },
      { comp: '쿠팡', stage: 'final', result: 'failed', date: '2026-08-01', dl: null },
      { comp: '배민', stage: 'document', result: 'withdrawn', date: '2026-07-20', dl: null },
    ];

    for (const item of stagesAndResults) {
      const jobRes = await userA.agent.post('/jobs').type('form').send({
        _csrf: userA.csrfToken,
        new_company_name: item.comp,
        title: `${item.comp} 채용`,
        deadline: item.dl,
      });
      const jobId = Number(jobRes.headers.location.split('/').pop());

      await userA.agent.post('/applications').type('form').send({
        _csrf: userA.csrfToken,
        job_post_id: jobId,
        stage: item.stage,
        result: item.result,
        applied_at: item.date,
      });
    }

    // User A: create an event
    await userA.agent.post('/events').type('form').send({
      _csrf: userA.csrfToken,
      title: '면접 일정',
      type: 'interview',
      starts_at: '2026-11-16 14:00',
    });

    // User A: create an essay with a version
    const essayRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '개발자 포트폴리오 자소서',
      question: '지원동기',
      answer: '성장하고 싶습니다.',
    });
    const essayId = Number(essayRes.headers.location.split('/').pop());
    await userA.agent.post(`/essays/${essayId}/versions`).type('form').send({
      _csrf: userA.csrfToken,
      label: 'v1 초안',
    });

    // User B: create 1 application (should NOT be counted in User A's stats)
    const bJobRes = await userB.agent.post('/jobs').type('form').send({
      _csrf: userB.csrfToken,
      new_company_name: '토스',
      title: '토스 백엔드',
      deadline: '2026-11-18',
    });
    const bJobId = Number(bJobRes.headers.location.split('/').pop());
    await userB.agent.post('/applications').type('form').send({
      _csrf: userB.csrfToken,
      job_post_id: bJobId,
      stage: 'document',
      result: 'in_progress',
      applied_at: '2026-11-05',
    });
  });

  after(() => {
    ctx.cleanup();
  });

  it('GET /api/dashboard/stats computes accurate totals, distributions, and user isolation', async () => {
    const resA = await userA.agent.get('/api/dashboard/stats');
    assert.equal(resA.status, 200);
    const statsA = resA.body;

    // Totals verification
    assert.equal(statsA.totals.totalApplications || statsA.totals.total, 5);
    assert.equal(statsA.totals.inProgress || statsA.totals.in_progress, 2);
    assert.equal(statsA.totals.passed, 1);
    assert.equal(statsA.totals.failed, 1);
    assert.equal(statsA.totals.withdrawn, 1);

    // Stage distribution for in_progress applications: document=1, coding_test=1, others=0
    assert.equal(statsA.stageDistribution.stages.length, 6);
    const docIdx = statsA.stageDistribution.stages.indexOf('document');
    const ctIdx = statsA.stageDistribution.stages.indexOf('coding_test');
    assert.equal(statsA.stageDistribution.counts[docIdx], 1);
    assert.equal(statsA.stageDistribution.counts[ctIdx], 1);

    // Result distribution
    assert.deepEqual(statsA.resultDistribution.counts, [2, 1, 1, 1]);

    // Essays count & version count
    assert.equal(statsA.totals.essaysCount, 1);
    assert.equal(statsA.totals.essayVersionsCount, 1);

    // Isolation check: User B has exactly 1 application
    const resB = await userB.agent.get('/api/dashboard/stats');
    assert.equal(resB.status, 200);
    const statsB = resB.body;
    assert.equal(statsB.totals.totalApplications || statsB.totals.total, 1);
    assert.equal(statsB.totals.inProgress || statsB.totals.in_progress, 1);
  });

  it('GET /dashboard renders 200 HTML with embedded JSON block and vendor chart scripts', async () => {
    const res = await userA.agent.get('/dashboard');
    assert.equal(res.status, 200);
    assert.match(res.text, /<h1 class="page-header__title">대시보드<\/h1>/);
    assert.match(res.text, /<script type="application\/json" id="dashboard-data">/);
    assert.match(res.text, /\/vendor\/chart\.js\/chart\.umd\.js/);
    assert.match(res.text, /\/js\/dashboard\.js/);
    assert.match(res.text, /진행 중 전형 단계별 분포/);
    assert.match(res.text, /전형 결과 비율/);
    assert.match(res.text, /최근 6개월 지원 추이/);
  });

  it('escapes < in JSON so company name with script tags does not appear raw in HTML', async () => {
    const xssCompName = '</script><script>alert(1)</script>';
    const jobRes = await userA.agent.post('/jobs').type('form').send({
      _csrf: userA.csrfToken,
      new_company_name: xssCompName,
      title: '보안 테스트 공고',
    });
    assert.equal(jobRes.status, 302);
    const jobId = Number(jobRes.headers.location.split('/').pop());

    await userA.agent.post('/applications').type('form').send({
      _csrf: userA.csrfToken,
      job_post_id: jobId,
      stage: 'document',
      result: 'in_progress',
    });

    const res = await userA.agent.get('/dashboard');
    assert.equal(res.status, 200);

    // Verify raw script tag does NOT exist in the HTML response
    assert.equal(
      res.text.includes(xssCompName),
      false,
      'Raw </script><script>alert(1)</script> must not appear in HTML'
    );
    // Verify it is escaped as \u003c
    assert.ok(
      res.text.includes('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>'),
      'Expected escaped \\u003c in JSON payload'
    );
  });
});
