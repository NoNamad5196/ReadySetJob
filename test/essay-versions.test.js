const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, signupAndLogin } = require('./helpers');

describe('Essay Versions: Immutability, Compare, Restore, and Security', () => {
  let ctx;
  let userA;
  let userB;

  before(async () => {
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, { email: 'vuser_a@readysetjob.dev', password: 'password123!', name: '버전작성자A' });
    userB = await signupAndLogin(ctx.app, { email: 'vuser_b@readysetjob.dev', password: 'password123!', name: '타인B' });
  });

  after(() => {
    ctx.cleanup();
  });

  it('creates versions with incrementing version_no and snapshots ordered questions', async () => {
    const createRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '버전 생성 테스트',
      question: ['질문 1', '질문 2'],
      char_limit: ['1000', '500'],
      answer: ['답변 1 초기버전', '답변 2 초기버전'],
    });
    const essayId = Number(createRes.headers.location.split('/').pop());

    const v1Res = await userA.agent
      .post(`/essays/${essayId}/versions`)
      .type('form')
      .send({ _csrf: userA.csrfToken, label: '초안 v1' });
    assert.equal(v1Res.status, 302);

    const v1Row = ctx.db.prepare('SELECT * FROM essay_versions WHERE essay_id = ? AND version_no = 1').get(essayId);
    assert.ok(v1Row);
    assert.equal(v1Row.version_no, 1);
    assert.equal(v1Row.label, '초안 v1');

    const v2Res = await userA.agent
      .post(`/essays/${essayId}/versions`)
      .type('form')
      .send({ _csrf: userA.csrfToken, label: '중간 v2' });
    assert.equal(v2Res.status, 302);

    const v2Row = ctx.db.prepare('SELECT * FROM essay_versions WHERE essay_id = ? AND version_no = 2').get(essayId);
    assert.ok(v2Row);
    assert.equal(v2Row.version_no, 2);

    const listRes = await userA.agent.get(`/essays/${essayId}/versions`);
    assert.equal(listRes.status, 200);
    assert.match(listRes.text, /초안 v1/);
    assert.match(listRes.text, /중간 v2/);

    const detailRes = await userA.agent.get(`/essays/${essayId}/versions/1`);
    assert.equal(detailRes.status, 200);
    assert.match(detailRes.text, /답변 1 초기버전/);
  });

  it('compare output contains <ins>/<del> and escapes HTML/XSS content strictly', async () => {
    const createRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: 'XSS 방어 및 Diff 테스트',
      question: ['보안 문항'],
      answer: ['안전한 원래 텍스트'],
    });
    const essayId = Number(createRes.headers.location.split('/').pop());

    await userA.agent.post(`/essays/${essayId}/versions`).type('form').send({ _csrf: userA.csrfToken, label: 'v1 원래 상태' });

    const qRow = ctx.db.prepare('SELECT id FROM essay_questions WHERE essay_id = ?').get(essayId);
    await userA.agent
      .put(`/api/essays/${essayId}/draft`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ answers: [{ question_id: qRow.id, answer: '안전한 변경된 <script>alert(1)</script> 텍스트' }] });

    await userA.agent.post(`/essays/${essayId}/versions`).type('form').send({ _csrf: userA.csrfToken, label: 'v2 변경본' });

    const compareRes = await userA.agent.get(`/essays/${essayId}/compare?from=1&to=2`);
    assert.equal(compareRes.status, 200);

    assert.match(compareRes.text, /<ins class="diff-ins">/);
    assert.match(compareRes.text, /<del class="diff-del">/);
    assert.match(compareRes.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(compareRes.text, /<script>alert\(1\)<\/script>/);
  });

  it('restore adds versions with restored_from_version_id and leaves earlier snapshot_json byte-identical', async () => {
    const createRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '복원 불변성 테스트',
      question: ['1번 문항'],
      answer: ['v1의 순수 원본 답변입니다.'],
    });
    const essayId = Number(createRes.headers.location.split('/').pop());

    await userA.agent.post(`/essays/${essayId}/versions`).type('form').send({ _csrf: userA.csrfToken, label: 'v1 최초버전' });
    const v1Before = ctx.db.prepare('SELECT snapshot_json FROM essay_versions WHERE essay_id = ? AND version_no = 1').get(essayId);

    const qRow = ctx.db.prepare('SELECT id FROM essay_questions WHERE essay_id = ?').get(essayId);
    await userA.agent
      .put(`/api/essays/${essayId}/draft`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ answers: [{ question_id: qRow.id, answer: 'v2에서 크게 수정한 답변입니다.' }] });

    await userA.agent.post(`/essays/${essayId}/versions`).type('form').send({ _csrf: userA.csrfToken, label: 'v2 수정본' });
    const v2Before = ctx.db.prepare('SELECT snapshot_json FROM essay_versions WHERE essay_id = ? AND version_no = 2').get(essayId);

    await userA.agent
      .put(`/api/essays/${essayId}/draft`)
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ answers: [{ question_id: qRow.id, answer: '복원 직전 작업 중이던 초안입니다.' }] });

    const restoreRes = await userA.agent
      .post(`/essays/${essayId}/versions/1/restore`)
      .type('form')
      .send({ _csrf: userA.csrfToken });
    assert.equal(restoreRes.status, 302);

    const v1After = ctx.db.prepare('SELECT snapshot_json FROM essay_versions WHERE essay_id = ? AND version_no = 1').get(essayId);
    const v2After = ctx.db.prepare('SELECT snapshot_json FROM essay_versions WHERE essay_id = ? AND version_no = 2').get(essayId);
    assert.equal(v1Before.snapshot_json, v1After.snapshot_json);
    assert.equal(v2Before.snapshot_json, v2After.snapshot_json);

    const allVersions = ctx.db
      .prepare('SELECT version_no, label, restored_from_version_id FROM essay_versions WHERE essay_id = ? ORDER BY version_no ASC')
      .all(essayId);

    assert.equal(allVersions.length, 4);
    assert.equal(allVersions[2].label, '복원 전 자동 저장');
    assert.equal(allVersions[3].label, 'v1에서 복원');
    const v1Row = ctx.db.prepare('SELECT id FROM essay_versions WHERE essay_id = ? AND version_no = 1').get(essayId);
    assert.equal(allVersions[3].restored_from_version_id, v1Row.id);

    const restoredDraft = ctx.db.prepare('SELECT answer FROM essay_questions WHERE essay_id = ?').get(essayId);
    assert.equal(restoredDraft.answer, 'v1의 순수 원본 답변입니다.');
  });

  it("enforces ownership: user B cannot view, compare, or restore user A's versions", async () => {
    const createRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '유저A의 비밀 버전 자소서',
      question: ['질문'],
    });
    const essayId = Number(createRes.headers.location.split('/').pop());
    await userA.agent.post(`/essays/${essayId}/versions`).type('form').send({ _csrf: userA.csrfToken, label: '비밀 v1' });

    assert.equal((await userB.agent.get(`/essays/${essayId}/versions`)).status, 404);
    assert.equal((await userB.agent.get(`/essays/${essayId}/versions/1`)).status, 404);
    assert.equal((await userB.agent.get(`/essays/${essayId}/compare?from=1&to=current`)).status, 404);
    assert.equal(
      (
        await userB.agent
          .post(`/essays/${essayId}/versions/1/restore`)
          .type('form')
          .send({ _csrf: userB.csrfToken })
      ).status,
      404
    );
  });
});
