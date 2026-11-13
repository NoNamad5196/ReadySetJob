const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const request = require('supertest');
const { createTestContext, signupAndLogin } = require('./helpers');
const { migrate, hasTable, hasColumn } = require('../src/db/migrate');
const { buildMinimalDocxBuffer, MAX_IMPORT_FILE_BYTES } = require('../src/services/libraryImportService');
const { setFetchImpl, resetRateLimit, AI_DISABLED_MESSAGE } = require('../src/services/aiService');

describe('Track C: Essay Library (/library), File Import, Editor Reuse, and AI Question Extraction', () => {
  let ctx;
  let userA;
  let userB;
  const envBackup = {};
  const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_MODEL_EXTRACT'];

  before(async () => {
    ENV_KEYS.forEach((k) => {
      envBackup[k] = process.env[k];
      delete process.env[k];
    });
    ctx = createTestContext();
    userA = await signupAndLogin(ctx.app, {
      email: 'lib_a@readysetjob.dev',
      password: 'passwordA123!',
      name: '라이브러리A',
    });
    userB = await signupAndLogin(ctx.app, {
      email: 'lib_b@readysetjob.dev',
      password: 'passwordB123!',
      name: '라이브러리B',
    });
  });

  beforeEach(() => {
    resetRateLimit();
    setFetchImpl(null);
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  after(() => {
    setFetchImpl(null);
    resetRateLimit();
    ENV_KEYS.forEach((k) => {
      if (envBackup[k] !== undefined) process.env[k] = envBackup[k];
      else delete process.env[k];
    });
    ctx.cleanup();
  });

  it('migrates essay_library table and columns idempotently when run twice on a legacy DB', () => {
    // Given a legacy database with partial essay_library table missing optional columns
    const legacyDb = new Database(':memory:');
    legacyDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE essay_library (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME NOT NULL DEFAULT (datetime('now')));
    `);
    assert.equal(hasColumn(legacyDb, 'essay_library', 'question'), false);
    assert.equal(hasColumn(legacyDb, 'essay_library', 'body'), false);
    assert.equal(hasColumn(legacyDb, 'essay_library', 'tags'), false);

    // When migrate is executed twice
    migrate(legacyDb);
    migrate(legacyDb);

    // Then essay_library has all required columns and indexes without error
    assert.equal(hasTable(legacyDb, 'essay_library'), true);
    assert.equal(hasColumn(legacyDb, 'essay_library', 'question'), true);
    assert.equal(hasColumn(legacyDb, 'essay_library', 'body'), true);
    assert.equal(hasColumn(legacyDb, 'essay_library', 'tags'), true);
    legacyDb.close();
  });

  it('enforces authentication and CSRF protection on /library and /api/library', async () => {
    // Given an unauthenticated client and an authenticated user without CSRF token
    const anon = request(ctx.app);

    // When requesting HTML and JSON endpoints without auth or without CSRF
    assert.equal((await anon.get('/library')).status, 302);
    assert.equal((await anon.get('/api/library')).status, 401);
    assert.equal(
      (await userA.agent.post('/library').type('form').send({ title: '제목', body: '본문' })).status,
      403
    );
    assert.equal(
      (await userA.agent.post('/api/library').send({ title: '제목', body: '본문' })).status,
      403
    );
  });

  it('performs full CRUD on library entries, escapes HTML, and enforces user_id isolation (404)', async () => {
    // Given User A creates a library entry
    const createRes = await userA.agent.post('/library').type('form').send({
      _csrf: userA.csrfToken,
      title: '대규모 트래픽 성능 개선 <script>alert(1)</script>',
      question: '직무 관련 문제 해결 경험을 서술하세요.',
      body: 'SQLite WAL 모드와 인덱스 최적화로 응답 속도를 65% 개선했습니다.',
      tags: '성능최적화, 백엔드, SQLite',
    });
    assert.equal(createRes.status, 302);
    const entryId = Number(createRes.headers.location.split('/').pop());
    assert.ok(entryId > 0);

    // When User A reads detail and list pages
    const detailRes = await userA.agent.get(`/library/${entryId}`);
    assert.equal(detailRes.status, 200);
    assert.match(detailRes.text, /href="\/library"/);
    assert.match(detailRes.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(detailRes.text.includes('<script>alert(1)</script>'), false);
    assert.match(detailRes.text, /SQLite WAL 모드와 인덱스 최적화/);

    // When User A updates the entry
    const updateRes = await userA.agent.post(`/library/${entryId}?_method=PUT`).type('form').send({
      _csrf: userA.csrfToken,
      _method: 'PUT',
      title: '대규모 트래픽 성능 개선 (수정본)',
      question: '수정된 문항 질문',
      body: '캐시 계층 도입 및 쿼리 튜닝을 수행했습니다.',
      tags: '성능최적화, 캐시',
    });
    assert.equal(updateRes.status, 302);

    const updatedDetail = await userA.agent.get(`/library/${entryId}`);
    assert.equal(updatedDetail.status, 200);
    assert.match(updatedDetail.text, /대규모 트래픽 성능 개선 \(수정본\)/);
    assert.match(updatedDetail.text, /캐시 계층 도입/);

    // Then User B is strictly isolated (404 on read, edit, update, delete)
    assert.equal((await userB.agent.get(`/library/${entryId}`)).status, 404);
    assert.equal((await userB.agent.get(`/library/${entryId}/edit`)).status, 404);
    assert.equal(
      (await userB.agent.post(`/library/${entryId}?_method=PUT`).type('form').send({
        _csrf: userB.csrfToken,
        _method: 'PUT',
        title: '침투 시도',
        body: '변조 본문',
      })).status,
      404
    );
    assert.equal(
      (await userB.agent.post(`/library/${entryId}?_method=DELETE`).type('form').send({
        _csrf: userB.csrfToken,
        _method: 'DELETE',
      })).status,
      404
    );

    // And User A can delete their own entry
    const delRes = await userA.agent.post(`/library/${entryId}?_method=DELETE`).type('form').send({
      _csrf: userA.csrfToken,
      _method: 'DELETE',
    });
    assert.equal(delRes.status, 302);
    assert.equal((await userA.agent.get(`/library/${entryId}`)).status, 404);
  });

  it('supports keyword + tag search in /library and /api/library/search and saves/loads in essay editor', async () => {
    // Given User A registers two distinct library entries and User B registers one
    await userA.agent.post('/api/library').set('X-CSRF-Token', userA.csrfToken).send({
      title: '협업 갈등 해결 사례',
      question: '팀원과 의견 충돌을 해결한 경험은?',
      body: 'API 명세서를 먼저 정의하여 프론트엔드와의 소통 비용을 줄였습니다.',
      tags: '협업,커뮤니케이션',
    });
    await userA.agent.post('/api/library').set('X-CSRF-Token', userA.csrfToken).send({
      title: '지원 동기 및 포부',
      question: '지원 동기를 작성해 주세요.',
      body: '안정적인 금융 플랫폼을 만드는 백엔드 엔지니어로 성장하고 싶습니다.',
      tags: '지원동기,포부',
    });
    await userB.agent.post('/api/library').set('X-CSRF-Token', userB.csrfToken).send({
      title: '타인B 비공개 스토리',
      body: 'API 명세서 타인 데이터',
      tags: '협업',
    });

    // When User A searches by keyword and by tag
    const kwRes = await userA.agent.get('/api/library/search?q=' + encodeURIComponent('명세서'));
    assert.equal(kwRes.status, 200);
    assert.equal(kwRes.body.results.length, 1);
    assert.equal(kwRes.body.results[0].title, '협업 갈등 해결 사례');

    const tagRes = await userA.agent.get('/library?tag=' + encodeURIComponent('지원동기'));
    assert.equal(tagRes.status, 200);
    assert.match(tagRes.text, /지원 동기 및 포부/);
    assert.doesNotMatch(tagRes.text, /협업 갈등 해결 사례/);
    assert.doesNotMatch(tagRes.text, /타인B 비공개 스토리/);

    // And in essay editor, User A can see the library panel and save a question answer to the library
    const essayRes = await userA.agent.post('/essays').type('form').send({
      _csrf: userA.csrfToken,
      title: '토스 백엔드 자소서',
      question: ['본인의 강점을 기술해 주세요.'],
      char_limit: ['1000'],
      answer: ['끈기 있는 디버깅 역량을 보유하고 있습니다.'],
    });
    const essayId = Number(essayRes.headers.location.split('/').pop());
    const editorRes = await userA.agent.get(`/essays/${essayId}`);
    assert.equal(editorRes.status, 200);
    assert.match(editorRes.text, /라이브러리에서 불러오기/);
    assert.match(editorRes.text, /답변에 불러오기/);
    assert.match(editorRes.text, /라이브러리에 저장/);

    const qRow = ctx.db.prepare('SELECT id FROM essay_questions WHERE essay_id = ?').get(essayId);
    const saveLibRes = await userA.agent
      .post(`/essays/${essayId}/questions/${qRow.id}/to-library`)
      .set('Accept', 'application/json')
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ answer: '끈기 있는 디버깅 역량을 보유하고 있습니다.' });
    assert.equal(saveLibRes.status, 201);
    assert.equal(saveLibRes.body.entry.body, '끈기 있는 디버깅 역량을 보유하고 있습니다.');
  });

  it('imports .txt and .docx files, auto-splits by question headings into preview, and saves split entries', async () => {
    // Given a multi-question .txt buffer and a generated .docx buffer
    const txtContent = [
      '1. 지원 동기 및 입사 후 포부를 기술해 주세요.',
      '사용자 중심의 웹 서비스를 개발하고자 지원했습니다.',
      '',
      '문항 2. 가장 도전적이었던 프로젝트 경험은 무엇인가요?',
      '실시간 알림 시스템을 구축하며 병목을 해결했습니다.',
    ].join('\n');

    // When uploading the .txt file to /library/import
    const txtRes = await userA.agent
      .post('/library/import')
      .field('_csrf', userA.csrfToken)
      .attach('file', Buffer.from(txtContent, 'utf8'), 'past_essay.txt');
    assert.equal(txtRes.status, 200);
    assert.match(txtRes.text, /분할 미리보기 및 편집/);
    assert.match(txtRes.text, /사용자 중심의 웹 서비스를 개발하고자 지원했습니다/);
    assert.match(txtRes.text, /실시간 알림 시스템을 구축하며 병목을 해결했습니다/);

    // And when uploading a valid .docx file to /api/library/import
    const docxBuffer = buildMinimalDocxBuffer([
      '1. 본인의 핵심 역량을 기술해 주세요.',
      'Node.js와 SQLite 기반 백엔드 설계 경험이 있습니다.',
      '2. 협업 중 갈등을 해결한 경험이 있나요?',
      '코드 리뷰 문화를 도입해 품질을 높였습니다.',
    ]);
    const docxRes = await userA.agent
      .post('/api/library/import')
      .set('X-CSRF-Token', userA.csrfToken)
      .attach('file', docxBuffer, 'career_essay.docx');
    assert.equal(docxRes.status, 200);
    assert.equal(docxRes.body.entries.length, 2);
    assert.match(docxRes.body.entries[0].question, /본인의 핵심 역량/);
    assert.match(docxRes.body.entries[0].body, /Node\.js와 SQLite/);
    assert.match(docxRes.body.entries[1].question, /협업 중 갈등을 해결한 경험/);

    // And when saving the split preview entries via POST /library/import/save
    const saveSplitRes = await userA.agent
      .post('/library/import/save')
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        title: ['DOCX 핵심 역량 (편집됨)', 'DOCX 협업 경험 (편집됨)'],
        question: [docxRes.body.entries[0].question, docxRes.body.entries[1].question],
        body: [docxRes.body.entries[0].body, docxRes.body.entries[1].body],
        tags: ['백엔드,역량', '협업,코드리뷰'],
      });
    assert.equal(saveSplitRes.status, 302);
    assert.equal(saveSplitRes.headers.location, '/library');

    const listAfterImport = await userA.agent.get('/library?q=' + encodeURIComponent('DOCX 핵심 역량'));
    assert.equal(listAfterImport.status, 200);
    assert.match(listAfterImport.text, /DOCX 핵심 역량 \(편집됨\)/);
  });

  it('rejects unsupported extensions, disguised magic bytes, and oversized (>5MB) uploads with 422', async () => {
    // 1. Unsupported extension (.exe)
    const unsupportedRes = await userA.agent
      .post('/library/import')
      .field('_csrf', userA.csrfToken)
      .attach('file', Buffer.from('plain text'), 'malware.exe');
    assert.equal(unsupportedRes.status, 422);
    assert.match(unsupportedRes.text, /지원하지 않는 파일 형식/);

    // 2. Disguised file: plain text renamed to .docx (fails PK zip + word/document.xml magic check)
    const disguisedDocxRes = await userA.agent
      .post('/library/import')
      .field('_csrf', userA.csrfToken)
      .attach('file', Buffer.from('not a real zip or docx file'), 'fake.docx');
    assert.equal(disguisedDocxRes.status, 422);
    assert.match(disguisedDocxRes.text, /시그니처|형식/);

    // 3. Disguised file: PNG binary renamed to .txt
    const disguisedTxtRes = await userA.agent
      .post('/library/import')
      .field('_csrf', userA.csrfToken)
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), 'fake.txt');
    assert.equal(disguisedTxtRes.status, 422);

    // 4. Oversized file (> 5MB)
    const oversizedBuf = Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1024, 'a');
    const oversizedRes = await userA.agent
      .post('/library/import')
      .field('_csrf', userA.csrfToken)
      .attach('file', oversizedBuf, 'too_big.txt');
    assert.equal(oversizedRes.status, 422);
    assert.match(oversizedRes.text, /5MB 이하/);
  });

  it('handles AI question extraction when AI is disabled (503 message, no env/model leak) and when AI is mocked', async () => {
    // 1. When OPENAI_API_KEY is unset (AI disabled)
    const newEssayPage = await userA.agent.get('/essays/new');
    assert.equal(newEssayPage.status, 200);
    assert.match(newEssayPage.text, new RegExp(AI_DISABLED_MESSAGE));
    assert.doesNotMatch(newEssayPage.text, /OPENAI_API_KEY|OPENAI_MODEL|gpt-6/);

    const disabledApiRes = await userA.agent
      .post('/api/essays/extract-questions')
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ text: '채용 공고 본문 텍스트' });
    assert.equal(disabledApiRes.status, 503);
    assert.equal(disabledApiRes.body.error, AI_DISABLED_MESSAGE);

    // 2. When AI is enabled and mocked via setFetchImpl
    process.env.OPENAI_API_KEY = 'sk-test-extract-questions';
    let capturedRequest = null;
    setFetchImpl(async (url, init) => {
      capturedRequest = { url, headers: init.headers, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          output_text: JSON.stringify({
            questions: [
              { question: '지원 동기 및 입사 후 이루고 싶은 목표를 기술해 주세요.', char_limit: 1000 },
              { question: '본인이 주도적으로 해결한 기술적 난관을 설명해 주세요.', char_limit: 1500 },
            ],
          }),
        }),
      };
    });

    const extractRes = await userA.agent
      .post('/api/essays/extract-questions')
      .set('X-CSRF-Token', userA.csrfToken)
      .send({ text: '[모집요강] 자소서 문항: 1) 지원동기 (1000자) 2) 기술적 난관 해결 경험 (1500자)' });
    assert.equal(extractRes.status, 200);
    assert.equal(capturedRequest.url, 'https://api.openai.com/v1/responses');
    assert.equal(capturedRequest.headers.Authorization, 'Bearer sk-test-extract-questions');
    assert.equal(extractRes.body.questions.length, 2);
    assert.equal(extractRes.body.questions[0].char_limit, 1000);
    assert.equal(extractRes.body.questions[1].char_limit, 1500);

    // Also test no-JS form POST to /essays/extract-questions pre-filling the essay creation form
    const formExtractRes = await userA.agent
      .post('/essays/extract-questions')
      .type('form')
      .send({
        _csrf: userA.csrfToken,
        title: 'AI 문항 추출 자소서',
        text: '[모집요강] 자소서 문항 안내 본문',
      });
    assert.equal(formExtractRes.status, 200);
    assert.match(formExtractRes.text, /지원 동기 및 입사 후 이루고 싶은 목표를 기술해 주세요/);
    assert.match(formExtractRes.text, /1500/);
  });
});
