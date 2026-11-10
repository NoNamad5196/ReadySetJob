const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');

describe('Companies, Job Posts, Applications, and Events CRUD', () => {
  let ctx;
  let userA;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'usera@readysetjob.dev',
      password: 'passwordA123!',
      name: '사용자A',
    });
  });

  after(() => {
    ctx.cleanup();
  });

  it('performs full CRUD on companies and enforces unique name per user', async () => {
    const createRes = await userA.agent.post('/companies').type('form').send({
      _csrf: userA.csrfToken,
      name: '네이버',
      industry: 'IT·포털',
      website: 'https://www.navercorp.com',
      memo: '검색 및 AI 기술',
    });
    assert.equal(createRes.status, 302);
    const companyLocation = createRes.headers.location;
    assert.match(companyLocation, /^\/companies\/\d+$/);
    const companyId = Number(companyLocation.split('/').pop());

    const dupRes = await userA.agent.post('/companies').type('form').send({
      _csrf: userA.csrfToken,
      name: '네이버',
      industry: 'IT',
    });
    assert.equal(dupRes.status, 422);

    const listRes = await userA.agent.get('/companies?q=네이버');
    assert.equal(listRes.status, 200);
    assert.match(listRes.text, /네이버/);

    const updateRes = await userA.agent
      .post(`/companies/${companyId}?_method=PUT`)
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        _method: 'PUT',
        name: '네이버클라우드',
        industry: '클라우드·AI',
        website: 'https://www.navercloudcorp.com',
        memo: '하이퍼클로바X 인프라',
      });
    assert.equal(updateRes.status, 302);

    const detailRes = await userA.agent.get(`/companies/${companyId}`);
    assert.equal(detailRes.status, 200);
    assert.match(detailRes.text, /네이버클라우드/);

    const toDeleteRes = await userA.agent.post('/companies').type('form').send({
      _csrf: userA.csrfToken,
      name: '임시삭제기업',
      industry: '기타',
    });
    const tempId = Number(toDeleteRes.headers.location.split('/').pop());

    const delRes = await userA.agent
      .post(`/companies/${tempId}?_method=DELETE`)
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        _method: 'DELETE',
      });
    assert.equal(delRes.status, 302);

    const afterDelRes = await userA.agent.get(`/companies/${tempId}`);
    assert.equal(afterDelRes.status, 404);
  });

  it('performs job post CRUD, new company transaction creation, and bookmark toggle', async () => {
    const createWithNewCompanyRes = await userA.agent.post('/jobs').type('form').send({
      _csrf: userA.csrfToken,
      new_company_name: '카카오',
      new_company_industry: '메신저·플랫폼',
      new_company_website: 'https://www.kakaocorp.com',
      title: '2026 신입 백엔드 개발자 채용',
      position: 'Server Engineer',
      employment_type: 'new_grad',
      url: 'https://careers.kakao.com',
      deadline: '2026-12-31',
      memo: '코딩테스트 필수',
      is_bookmarked: '0',
    });
    assert.equal(createWithNewCompanyRes.status, 302);
    const jobId = Number(createWithNewCompanyRes.headers.location.split('/').pop());

    const detailRes = await userA.agent.get(`/jobs/${jobId}`);
    assert.equal(detailRes.status, 200);
    assert.match(detailRes.text, /2026 신입 백엔드 개발자 채용/);
    assert.match(detailRes.text, /카카오/);

    const bookmarkRes1 = await userA.agent
      .post(`/jobs/${jobId}/bookmark`)
      .set('Accept', 'application/json')
      .send({ _csrf: userA.csrfToken });
    assert.equal(bookmarkRes1.status, 200);
    assert.equal(bookmarkRes1.body.is_bookmarked, 1);

    const bookmarkedListRes = await userA.agent.get('/jobs?bookmarked=1');
    assert.equal(bookmarkedListRes.status, 200);
    assert.match(bookmarkedListRes.text, /2026 신입 백엔드 개발자 채용/);

    const bookmarkRes2 = await userA.agent
      .post(`/jobs/${jobId}/bookmark`)
      .set('Accept', 'application/json')
      .send({ _csrf: userA.csrfToken });
    assert.equal(bookmarkRes2.status, 200);
    assert.equal(bookmarkRes2.body.is_bookmarked, 0);

    const jobRow = ctx.db.prepare('SELECT company_id FROM job_posts WHERE id = ?').get(jobId);
    const updateRes = await userA.agent
      .post(`/jobs/${jobId}?_method=PUT`)
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        _method: 'PUT',
        company_id: jobRow.company_id,
        title: '2026 신입 백엔드 개발자 공채 (수정됨)',
        position: 'Backend Developer',
        employment_type: 'new_grad',
        url: 'https://careers.kakao.com',
        deadline: '2026-12-25',
        memo: '1차 코테 + 2차 과제',
        is_bookmarked: '1',
      });
    assert.equal(updateRes.status, 302);

    const updatedDetail = await userA.agent.get(`/jobs/${jobId}`);
    assert.equal(updatedDetail.status, 200);
    assert.match(updatedDetail.text, /2026 신입 백엔드 개발자 공채 \(수정됨\)/);
  });

  it('performs application CRUD, logs stage changes on PATCH, and rejects invalid stages', async () => {
    const userAId = ctx.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get('usera@readysetjob.dev').id;
    const jobRow = ctx.db
      .prepare('SELECT id FROM job_posts WHERE user_id = ? LIMIT 1')
      .get(userAId);

    const createAppRes = await userA.agent.post('/applications').type('form').send({
      _csrf: userA.csrfToken,
      job_post_id: jobRow.id,
      stage: 'document',
      result: 'in_progress',
      applied_at: '2026-11-10',
      memo: '자소서 제출 완료',
    });
    assert.equal(createAppRes.status, 302);
    const appId = Number(createAppRes.headers.location.split('/').pop());

    const patchRes = await userA.agent
      .patch(`/api/applications/${appId}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({
        stage: 'coding_test',
        result: 'in_progress',
        board_order: 2,
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.stage, 'coding_test');
    assert.equal(patchRes.body.board_order, 2);

    const logs = ctx.db
      .prepare('SELECT * FROM stage_logs WHERE application_id = ? ORDER BY id ASC')
      .all(appId);
    assert.equal(logs.length, 2);
    assert.equal(logs[1].from_stage, 'document');
    assert.equal(logs[1].to_stage, 'coding_test');

    const invalidStageRes = await userA.agent
      .patch(`/api/applications/${appId}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ stage: 'invalid_stage_name' });
    assert.equal(invalidStageRes.status, 422);

    const invalidResultRes = await userA.agent
      .patch(`/api/applications/${appId}/stage`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ stage: 'interview1', result: 'invalid_result_name' });
    assert.equal(invalidResultRes.status, 422);
  });

  it('performs events CRUD linked to an application', async () => {
    const appRow = ctx.db.prepare('SELECT id FROM applications LIMIT 1').get();

    const createEventRes = await userA.agent.post('/events').type('form').send({
      _csrf: userA.csrfToken,
      application_id: appRow.id,
      title: '카카오 1차 코딩테스트',
      type: 'test',
      starts_at: '2026-11-20T14:00',
      memo: '프로그래머스 환경',
    });
    assert.equal(createEventRes.status, 302);

    const listEventsRes = await userA.agent.get('/events');
    assert.equal(listEventsRes.status, 200);
    assert.match(listEventsRes.text, /카카오 1차 코딩테스트/);

    const eventRow = ctx.db
      .prepare('SELECT id FROM events WHERE title = ?')
      .get('카카오 1차 코딩테스트');
    assert.ok(eventRow);

    const delEventRes = await userA.agent
      .post(`/events/${eventRow.id}?_method=DELETE`)
      .type('form')
      .send({ _csrf: userA.csrfToken, _method: 'DELETE' });
    assert.equal(delEventRes.status, 302);

    const goneRow = ctx.db.prepare('SELECT id FROM events WHERE id = ?').get(eventRow.id);
    assert.equal(goneRow, undefined);
  });
});
