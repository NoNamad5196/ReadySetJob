const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');

describe('Materials (/materials) CRUD, Validation, Ownership, CSRF, Search', () => {
  let ctx;
  let userA;
  let userB;
  let materialAId;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'mat_a@readysetjob.dev',
      password: 'passwordA123!',
      name: '자료테스터A',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'mat_b@readysetjob.dev',
      password: 'passwordB123!',
      name: '자료테스터B',
    });
  });

  after(() => {
    ctx.cleanup();
  });

  it('performs full CRUD on materials (create, read, edit, delete)', async () => {
    // 1. Create
    const createRes = await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'project',
      title: '웹 서비스 토이 프로젝트',
      period: '2026.03 ~ 2026.06',
      tags: ' Node.js , Express, SQLite ',
      content: '채용 관리 웹 서비스를 1인 개발하며 MVC 아키텍처 적용.',
    });
    assert.equal(createRes.status, 302);
    materialAId = Number(createRes.headers.location.split('/').pop());
    assert.ok(materialAId > 0);

    // 2. Read detail
    const detailRes = await userA.agent.get(`/materials/${materialAId}`);
    assert.equal(detailRes.status, 200);
    assert.match(detailRes.text, /웹 서비스 토이 프로젝트/);
    assert.match(detailRes.text, /프로젝트/);
    assert.match(detailRes.text, /2026\.03 ~ 2026\.06/);
    assert.match(detailRes.text, /Node\.js/);
    assert.match(detailRes.text, /채용 관리 웹 서비스/);

    // 3. Read list
    const listRes = await userA.agent.get('/materials');
    assert.equal(listRes.status, 200);
    assert.match(listRes.text, /웹 서비스 토이 프로젝트/);

    // 4. Update
    const updateRes = await userA.agent
      .post(`/materials/${materialAId}?_method=PUT`)
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        _method: 'PUT',
        kind: 'project',
        title: '웹 서비스 토이 프로젝트 (수정)',
        period: '2026.03 ~ 2026.08',
        tags: 'Node.js, Express, SQLite, Chart.js',
        content: '대시보드 통계 기능 추가 및 Chart.js 적용.',
      });
    assert.equal(updateRes.status, 302);

    const updatedDetail = await userA.agent.get(`/materials/${materialAId}`);
    assert.equal(updatedDetail.status, 200);
    assert.match(updatedDetail.text, /웹 서비스 토이 프로젝트 \(수정\)/);
    assert.match(updatedDetail.text, /Chart\.js/);

    // 5. Delete
    const deleteRes = await userA.agent
      .post(`/materials/${materialAId}?_method=DELETE`)
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        _method: 'DELETE',
      });
    assert.equal(deleteRes.status, 302);

    const getDeleted = await userA.agent.get(`/materials/${materialAId}`);
    assert.equal(getDeleted.status, 404);
  });

  it('enforces validation (422) on create and update', async () => {
    // Missing title
    const r1 = await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'experience',
      title: '   ',
    });
    assert.equal(r1.status, 422);
    assert.match(r1.text, /제목을 입력해 주세요/);

    // Title exceeds 120 chars
    const r2 = await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'experience',
      title: 'A'.repeat(121),
    });
    assert.equal(r2.status, 422);
    assert.match(r2.text, /120자 이하/);

    // Invalid kind
    const r3 = await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'unknown_kind',
      title: '유효한 제목',
    });
    assert.equal(r3.status, 422);
    assert.match(r3.text, /올바른/);

    // Period exceeds 60 chars
    const r4 = await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'experience',
      title: '유효한 제목',
      period: 'P'.repeat(61),
    });
    assert.equal(r4.status, 422);
    assert.match(r4.text, /60자 이하/);

    // Content exceeds 5000 chars
    const r5 = await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'experience',
      title: '유효한 제목',
      content: 'C'.repeat(5001),
    });
    assert.equal(r5.status, 422);
    assert.match(r5.text, /5000자 이하/);
  });

  it('enforces ownership (404) across all materials endpoints', async () => {
    // Create material as User A
    const resA = await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'award',
      title: 'User A의 수상 내역',
      content: '교내 해커톤 대상 수상',
    });
    assert.equal(resA.status, 302);
    const targetId = Number(resA.headers.location.split('/').pop());

    // User B attempts to GET detail -> 404
    const getRes = await userB.agent.get(`/materials/${targetId}`);
    assert.equal(getRes.status, 404);

    // User B attempts to GET edit form -> 404
    const editRes = await userB.agent.get(`/materials/${targetId}/edit`);
    assert.equal(editRes.status, 404);

    // User B attempts to PUT update -> 404
    const putRes = await userB.agent
      .post(`/materials/${targetId}?_method=PUT`)
      .type('form')
      .send({
        _csrf: userB.csrfToken,
        _method: 'PUT',
        kind: 'award',
        title: 'User B가 변조 시도',
      });
    assert.equal(putRes.status, 404);

    // User B attempts to DELETE -> 404
    const delRes = await userB.agent
      .post(`/materials/${targetId}?_method=DELETE`)
      .type('form')
      .send({
        _csrf: userB.csrfToken,
        _method: 'DELETE',
      });
    assert.equal(delRes.status, 404);

    // Confirm material still exists for User A
    const checkA = await userA.agent.get(`/materials/${targetId}`);
    assert.equal(checkA.status, 200);
    assert.match(checkA.text, /User A의 수상 내역/);
  });

  it('rejects state-changing requests without CSRF token with 403', async () => {
    const postRes = await userA.agent.post('/materials').type('form').send({
      title: 'CSRF 누락 자료',
    });
    assert.equal(postRes.status, 403);
  });

  it('filters by kind and searches by keyword q over title, content, and tags', async () => {
    await userA.agent.post('/materials').type('form').send({
      _csrf: userA.csrfToken,
      kind: 'activity',
      title: '오픈소스 동아리 멘토링',
      tags: '커뮤니티, 멘토링',
      content: '주니어 개발자 대상 깃허브 사용법 강의 진행',
    });

    // Search by title keyword
    const rTitle = await userA.agent.get('/materials?q=멘토링');
    assert.equal(rTitle.status, 200);
    assert.match(rTitle.text, /오픈소스 동아리 멘토링/);

    // Search by tag keyword
    const rTag = await userA.agent.get('/materials?q=커뮤니티');
    assert.equal(rTag.status, 200);
    assert.match(rTag.text, /오픈소스 동아리 멘토링/);

    // Filter by kind
    const rKind = await userA.agent.get('/materials?kind=activity');
    assert.equal(rKind.status, 200);
    assert.match(rKind.text, /오픈소스 동아리 멘토링/);

    // Filter by mismatched kind
    const rDiffKind = await userA.agent.get('/materials?kind=project');
    assert.equal(rDiffKind.status, 200);
    assert.doesNotMatch(rDiffKind.text, /오픈소스 동아리 멘토링/);
  });
});
