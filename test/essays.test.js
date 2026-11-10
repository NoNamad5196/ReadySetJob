const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');

describe('Essays CRUD, Draft Save, Questions, Search, and Ownership', () => {
  let ctx;
  let userA;
  let userB;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'essay_a@readysetjob.dev', password: 'password123!', name: '작성자A' });
    userB = await signupAndLogin(ctx.app, { email: 'essay_b@readysetjob.dev', password: 'password123!', name: '타인B' });
  });

  after(() => {
    ctx.cleanup();
  });

  it('creates an essay with questions and renders the list and editor', async () => {
    const res = await userA.agent
      .post('/essays')
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        title: '네이버 신입 공채 자기소개서',
        question: ['지원 동기를 기술해 주세요.', '직무 경험을 서술해 주세요.'],
        char_limit: ['1000', '1500'],
      });

    assert.equal(res.status, 302);
    const essayId = Number(res.headers.location.split('/').pop());
    assert.ok(essayId > 0);

    const listRes = await userA.agent.get('/essays');
    assert.equal(listRes.status, 200);
    assert.match(listRes.text, /네이버 신입 공채 자기소개서/);

    const editorRes = await userA.agent.get(`/essays/${essayId}`);
    assert.equal(editorRes.status, 200);
    assert.match(editorRes.text, /지원 동기를 기술해 주세요/);
    assert.match(editorRes.text, /직무 경험을 서술해 주세요/);
  });

  it('draft save updates question answers ONLY and does NOT create versions', async () => {
    const createRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '드래프트 테스트 자소서',
      question: ['문항 1번 질문'],
      char_limit: ['500'],
    });
    const essayId = Number(createRes.headers.location.split('/').pop());
    const qRow = ctx.db.prepare('SELECT id FROM essay_questions WHERE essay_id = ?').get(essayId);

    const versionsBefore = ctx.db.prepare('SELECT COUNT(*) AS cnt FROM essay_versions WHERE essay_id = ?').get(essayId).cnt;
    assert.equal(versionsBefore, 0);

    const draftRes = await userA.agent
      .put(`/api/essays/${essayId}/draft`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ answers: [{ question_id: qRow.id, answer: '새로 작성한 초안 답변입니다.' }] });

    assert.equal(draftRes.status, 200);
    assert.ok(draftRes.body.saved_at);

    const updatedQ = ctx.db.prepare('SELECT answer FROM essay_questions WHERE id = ?').get(qRow.id);
    assert.equal(updatedQ.answer, '새로 작성한 초안 답변입니다.');

    const versionsAfter = ctx.db.prepare('SELECT COUNT(*) AS cnt FROM essay_versions WHERE essay_id = ?').get(essayId).cnt;
    assert.equal(versionsAfter, 0);
  });

  it('rejects JSON draft save without CSRF token with 403', async () => {
    const essayRow = ctx.db.prepare('SELECT id FROM essays LIMIT 1').get();
    const res = await userA.agent.put(`/api/essays/${essayRow.id}/draft`).send({ answers: [] });
    assert.equal(res.status, 403);
  });

  it('supports question management (add, update, move, delete)', async () => {
    const createRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '문항 관리 테스트',
      question: ['기존 1번 문항'],
    });
    const essayId = Number(createRes.headers.location.split('/').pop());

    const addRes = await userA.agent
      .post(`/essays/${essayId}/questions`)
      .type('form')
      .send({ _csrf: userA.csrfToken, question: '새로 추가된 2번 문항', char_limit: '800' });
    assert.equal(addRes.status, 302);

    const qRows = ctx.db.prepare('SELECT * FROM essay_questions WHERE essay_id = ? ORDER BY sort_order ASC').all(essayId);
    assert.equal(qRows.length, 2);
    assert.equal(qRows[1].question, '새로 추가된 2번 문항');

    const updateRes = await userA.agent
      .post(`/essays/${essayId}/questions/${qRows[1].id}?_method=PUT`)
      .type('form')
      .send({ _csrf: userA.csrfToken, _method: 'PUT', question: '수정된 2번 문항', char_limit: '900' });
    assert.equal(updateRes.status, 302);

    const moveRes = await userA.agent
      .post(`/essays/${essayId}/questions/${qRows[1].id}/move`)
      .type('form')
      .send({ _csrf: userA.csrfToken, dir: 'up' });
    assert.equal(moveRes.status, 302);

    const movedRows = ctx.db.prepare('SELECT * FROM essay_questions WHERE essay_id = ? ORDER BY sort_order ASC').all(essayId);
    assert.equal(movedRows[0].id, qRows[1].id);

    const delRes = await userA.agent
      .post(`/essays/${essayId}/questions/${qRows[0].id}?_method=DELETE`)
      .type('form')
      .send({ _csrf: userA.csrfToken, _method: 'DELETE' });
    assert.equal(delRes.status, 302);

    const remainRows = ctx.db.prepare('SELECT * FROM essay_questions WHERE essay_id = ?').all(essayId);
    assert.equal(remainRows.length, 1);

    const failDelRes = await userA.agent
      .post(`/essays/${essayId}/questions/${remainRows[0].id}?_method=DELETE`)
      .type('form')
      .send({ _csrf: userA.csrfToken, _method: 'DELETE' });
    assert.equal(failDelRes.status, 422);
  });

  it('search API returns only own essays and excludes current essay', async () => {
    const essayA = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '유저A의 비밀 프로젝트 자소서',
      question: ['프로젝트 기여도'],
      answer: ['리액트 성능 최적화 경험'],
    });
    const idA = Number(essayA.headers.location.split('/').pop());

    await userB.agent.post('/essays').type('form').send({
      _csrf: userB.csrfToken,
      title: '유저B의 다른 자소서',
      question: ['프로젝트 기여도'],
      answer: ['뷰 성능 최적화 경험'],
    });

    const searchB = await userB.agent.get('/api/essays/search?q=최적화');
    assert.equal(searchB.status, 200);
    assert.equal(searchB.body.results.length, 1);
    assert.equal(searchB.body.results[0].essay_title, '유저B의 다른 자소서');

    const searchExclude = await userA.agent.get(`/api/essays/search?q=최적화&exclude_essay_id=${idA}`);
    assert.equal(searchExclude.status, 200);
    assert.ok(!searchExclude.body.results.some((r) => r.essay_id === idA));
  });

  it("enforces ownership: user B gets 404 when accessing user A's essay", async () => {
    const resA = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '유저A 전용 자소서',
      question: ['질문'],
    });
    const idA = Number(resA.headers.location.split('/').pop());

    assert.equal((await userB.agent.get(`/essays/${idA}`)).status, 404);
    assert.equal((await userB.agent.put(`/api/essays/${idA}/draft`).set('X-CSRF-Token', userB.csrfToken).send({ answers: [] })).status, 404);
    assert.equal(
      (
        await userB.agent
          .post(`/essays/${idA}?_method=DELETE`)
          .type('form')
          .send({ _csrf: userB.csrfToken, _method: 'DELETE' })
      ).status,
      404
    );
  });
});
