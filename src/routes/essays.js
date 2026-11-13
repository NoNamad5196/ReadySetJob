const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createHttpError } = require('../middleware/error');
const { safeRedirectPath, parseId } = require('../middleware/validation');
const {
  listUserApplications, getOwnedApplication, listEssays, getEssayById, createEssay, saveEssayDraft,
  addEssayQuestion, updateEssayQuestion, deleteEssayQuestion, moveEssayQuestion,
  createEssayVersion, getEssayVersion, restoreEssayVersion, compareEssayVersions,
  searchEssayQuestions, linkMaterialToEssay, unlinkMaterialFromEssay, deleteEssay,
} = require('../services/essaysService');
const { scheduleAutoFeedback } = require('../services/automationService');
const { listLibraryEntries, createLibraryEntry } = require('../services/libraryService');

const toArray = (val) => (val === undefined || val === null ? [] : Array.isArray(val) ? val : [val]);

function isValidCharLimit(val) {
  if (val === undefined || val === null || String(val).trim() === '') return true;
  const num = Number(val);
  return Number.isInteger(num) && num > 0 && num <= 50000;
}

const parseQuestionsFromBody = (body) =>
  Array.isArray(body.questions)
    ? body.questions.map((q) => ({ question: String(q.question || '').trim(), char_limit: String(q.char_limit ?? '').trim(), answer: String(q.answer || '') }))
    : toArray(body.question).map((q, idx) => ({ question: String(q || '').trim(), char_limit: String(toArray(body.char_limit)[idx] ?? '').trim(), answer: String(toArray(body.answer)[idx] ?? '') }));

const parseDraftAnswersFromBody = (body, existingQuestions = []) => {
  const arr = Array.isArray(body.answers) ? body.answers : Array.isArray(body.questions) ? body.questions : null;
  if (arr) return arr.map((a) => ({ question_id: Number(a.question_id || a.id), answer: String(a.answer ?? '') }));
  const qIds = toArray(body.question_id), ansArr = toArray(body.answer);
  if (qIds.length > 0) return qIds.map((qid, idx) => ({ question_id: Number(qid), answer: String(ansArr[idx] ?? '') }));
  return existingQuestions.filter((q) => `answer_${q.id}` in body).map((q) => ({ question_id: q.id, answer: String(body[`answer_${q.id}`] ?? '') }));
};

const renderEditorView = (res, db, { userId, essay, refQ = '', libQ = '', libTag = '', activeTab = 'past', status = 200, error = null }) =>
  res.status(status).render('essays/editor', {
    title: `${essay.title} — 자기소개서 편집`, essay,
    applications: listUserApplications(db, userId),
    pastQuestions: searchEssayQuestions(db, userId, { q: refQ, excludeEssayId: essay.id }),
    libraryEntries: listLibraryEntries(db, userId, { q: libQ, tag: libTag }),
    refQ, libQ, libTag, activeTab, error,
  });

function createEssaysRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.param('id', (req, res, next, v) => (req.params.id = parseId(v)) ? next() : next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.')));
  router.param('qid', (req, res, next, v) => (req.params.qid = parseId(v)) ? next() : next(createHttpError(404, '요청한 문항을 찾을 수 없습니다.')));
  router.param('no', (req, res, next, v) => (req.params.no = parseId(v)) ? next() : next(createHttpError(404, '요청한 버전을 찾을 수 없습니다.')));
  router.param('materialId', (req, res, next, v) => (req.params.materialId = parseId(v)) ? next() : next(createHttpError(404, '자기소개서 또는 경험 자료를 찾을 수 없습니다.')));

  router.get('/', (req, res) => {
    const userId = req.session.user.id;
    const q = String(req.query.q || '').trim();
    const application_id = req.query.application_id ? Number(req.query.application_id) : '';
    const essays = listEssays(db, userId, { q, application_id });
    const applications = listUserApplications(db, userId);
    return res.render('essays/index', { title: '자기소개서', essays, q, application_id, applications });
  });

  router.get('/new', (req, res) => {
    const applications = listUserApplications(db, req.session.user.id);
    const preselectedAppId = req.query.application_id ? Number(req.query.application_id) : '';
    const defaultQuestions = [
      { question: '지원 동기 및 입사 후 포부를 기술해 주세요.', char_limit: 1000, answer: '' },
      { question: '직무 관련 핵심 프로젝트 경험과 문제 해결 과정을 기술해 주세요.', char_limit: 1000, answer: '' },
    ];
    return res.render('essays/form', { title: '새 자기소개서 작성', error: null, applications, essay: { title: '', application_id: preselectedAppId, questions: defaultQuestions } });
  });

  router.post('/', (req, res, next) => {
    const userId = req.session.user.id;
    const title = String(req.body.title || '').trim();
    let application_id = null;
    const rawAppId = req.body.application_id;
    const rawQuestions = parseQuestionsFromBody(req.body);
    const nonEmptyQuestions = rawQuestions.filter((q) => q.question.length > 0);
    const applications = listUserApplications(db, userId);

    const renderInvalid = (error) =>
      res.status(422).render('essays/form', {
        title: '새 자기소개서 작성', error, applications,
        essay: { title, application_id: application_id || '', questions: rawQuestions.length > 0 ? rawQuestions : [{ question: '', char_limit: 1000, answer: '' }] },
      });

    if (rawAppId !== undefined && rawAppId !== null && String(rawAppId).trim() !== '') {
      application_id = parseId(rawAppId);
      if (!application_id) return renderInvalid('올바른 지원 내역을 선택해 주세요.');
    }
    if (!title) return renderInvalid('자기소개서 제목을 입력해 주세요.');
    if (nonEmptyQuestions.length === 0) return renderInvalid('최소 1개 이상의 문항을 입력해 주세요.');
    if (nonEmptyQuestions.some((q) => !isValidCharLimit(q.char_limit))) return renderInvalid('글자수 제한은 1 이상의 정수로 입력해 주세요.');
    if (application_id && !getOwnedApplication(db, userId, application_id)) return next(createHttpError(404, '연결할 지원 내역을 찾을 수 없습니다.'));

    try {
      const created = createEssay(db, userId, { title, application_id, questions: nonEmptyQuestions });
      req.setFlash('success', '자기소개서가 생성되었습니다.');
      return res.redirect(`/essays/${created.id}`);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    const essay = getEssayById(db, req.session.user.id, req.params.id);
    if (!essay) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    const refQ = String(req.query.ref_q || '').trim();
    const libQ = String(req.query.lib_q || '').trim();
    const libTag = String(req.query.lib_tag || '').trim();
    const activeTab = req.query.tab === 'materials' ? 'materials' : req.query.tab === 'library' ? 'library' : 'past';
    return renderEditorView(res, db, { userId: req.session.user.id, essay, refQ, libQ, libTag, activeTab });
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getEssayById(db, userId, req.params.id);
    if (!existing) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));

    const title = req.body.title !== undefined ? String(req.body.title).trim() : existing.title;
    if (!title) return renderEditorView(res, db, { userId, essay: existing, status: 422, error: '자기소개서 제목을 입력해 주세요.' });

    let application_id = existing.application_id;
    const rawAppId = req.body.application_id;
    if (rawAppId !== undefined) {
      application_id = rawAppId === null || String(rawAppId).trim() === '' ? null : parseId(rawAppId);
      if (rawAppId !== null && String(rawAppId).trim() !== '' && !application_id) {
        return renderEditorView(res, db, { userId, essay: existing, status: 422, error: '올바른 지원 내역을 선택해 주세요.' });
      }
    }
    if (application_id && !getOwnedApplication(db, userId, application_id)) return next(createHttpError(404, '연결할 지원 내역을 찾을 수 없습니다.'));

    try {
      saveEssayDraft(db, userId, { essayId: existing.id, title, application_id, answers: parseDraftAnswersFromBody(req.body, existing.questions) });
    } catch (err) {
      return next(err);
    }
    req.setFlash('success', '초안이 저장되었습니다.');
    return res.redirect(`/essays/${existing.id}`);
  });

  router.post('/:id/questions', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getEssayById(db, userId, req.params.id);
    if (!existing) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    const question = String(req.body.question || '').trim(), char_limit = String(req.body.char_limit ?? '').trim();
    if (!question || !isValidCharLimit(char_limit)) {
      return renderEditorView(res, db, { userId, essay: existing, status: 422, error: !question ? '문항 질문을 입력해 주세요.' : '글자수 제한은 1 이상의 정수여야 합니다.' });
    }
    addEssayQuestion(db, userId, { essayId: existing.id, question, char_limit, answer: req.body.answer || '' });
    req.setFlash('success', '새 문항이 추가되었습니다.');
    return res.redirect(`/essays/${existing.id}`);
  });

  router.put('/:id/questions/:qid', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getEssayById(db, userId, req.params.id);
    if (!existing) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    const question = String(req.body.question || '').trim(), char_limit = String(req.body.char_limit ?? '').trim();
    if (!question || !isValidCharLimit(char_limit)) {
      return renderEditorView(res, db, { userId, essay: existing, status: 422, error: !question ? '문항 질문을 입력해 주세요.' : '글자수 제한은 1 이상의 정수여야 합니다.' });
    }
    if (!updateEssayQuestion(db, userId, { essayId: existing.id, questionId: req.params.qid, question, char_limit })) {
      return next(createHttpError(404, '요청한 문항을 찾을 수 없습니다.'));
    }
    req.setFlash('success', '문항 정보가 수정되었습니다.');
    return res.redirect(`/essays/${existing.id}`);
  });

  router.delete('/:id/questions/:qid', (req, res, next) => {
    const userId = req.session.user.id;
    const result = deleteEssayQuestion(db, userId, { essayId: req.params.id, questionId: req.params.qid });
    if (!result) return next(createHttpError(404, '요청한 문항을 찾을 수 없습니다.'));
    if (result.error === 'MIN_ONE_QUESTION') {
      const existing = getEssayById(db, userId, req.params.id);
      return renderEditorView(res, db, { userId, essay: existing, status: 422, error: '자기소개서에는 최소 1개의 문항이 있어야 합니다.' });
    }
    req.setFlash('success', '문항이 삭제되었습니다.');
    return res.redirect(`/essays/${req.params.id}`);
  });

  router.post('/:id/questions/:qid/move', (req, res, next) => {
    const dir = String(req.body.dir || '').trim();
    if (dir !== 'up' && dir !== 'down') return res.status(422).send('유효하지 않은 이동 방향입니다.');
    if (!moveEssayQuestion(db, req.session.user.id, { essayId: req.params.id, questionId: req.params.qid, dir })) {
      return next(createHttpError(404, '요청한 문항을 찾을 수 없습니다.'));
    }
    return res.redirect(`/essays/${req.params.id}`);
  });

  router.post('/:id/questions/:qid/to-library', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getEssayById(db, userId, req.params.id);
    if (!existing) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    const targetQ = existing.questions.find((q) => q.id === req.params.qid);
    if (!targetQ) return next(createHttpError(404, '요청한 문항을 찾을 수 없습니다.'));
    const bodyText = String(req.body.answer !== undefined ? req.body.answer : targetQ.answer || '').trim();
    if (!bodyText) {
      if (req.get('Accept')?.includes('application/json')) return res.status(422).json({ error: '라이브러리에 저장할 답변 내용을 먼저 입력해 주세요.' });
      return renderEditorView(res, db, { userId, essay: existing, status: 422, error: '라이브러리에 저장할 답변 내용을 먼저 입력해 주세요.' });
    }
    const title = String(req.body.title || `${existing.title} — 문항 ${targetQ.sort_order}`).trim().slice(0, 200);
    const question = String(req.body.question || targetQ.question || '').trim().slice(0, 500);
    const tags = String(req.body.tags || existing.company_name || '').trim().slice(0, 300);
    const entry = createLibraryEntry(db, userId, { title, question, body: bodyText, tags });
    if (req.get('Accept')?.includes('application/json')) return res.status(201).json({ ok: true, entry });
    req.setFlash('success', '답변이 자소서 라이브러리에 저장되었습니다.');
    return res.redirect(`/essays/${existing.id}?tab=library`);
  });

  router.post('/:id/versions', (req, res, next) => {
    const version = createEssayVersion(db, req.session.user.id, { essayId: req.params.id, label: String(req.body.label || '').trim() });
    if (!version) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    const feedbackTask = scheduleAutoFeedback(db, req.session.user.id, req.params.id);
    req.setFlash(
      'success',
      feedbackTask
        ? `v${version.version_no} 버전이 저장되었습니다. AI 피드백을 백그라운드에서 생성 중입니다(잠시 후 새로고침).`
        : `v${version.version_no} 버전이 생성되었습니다.`
    );
    return res.redirect(safeRedirectPath(req.body.redirect_to, `/essays/${req.params.id}`));
  });

  router.get('/:id/versions', (req, res, next) => {
    const essay = getEssayById(db, req.session.user.id, req.params.id);
    if (!essay) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    return res.render('essays/versions', { title: `${essay.title} — 버전 기록`, essay, versions: essay.versions });
  });

  router.get('/:id/versions/:no', (req, res, next) => {
    const userId = req.session.user.id;
    const essay = getEssayById(db, userId, req.params.id);
    if (!essay) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    const version = getEssayVersion(db, userId, { essayId: essay.id, versionNo: req.params.no });
    if (!version) return next(createHttpError(404, '요청한 버전을 찾을 수 없습니다.'));
    return res.render('essays/version-detail', { title: `${essay.title} v${version.version_no} — 버전 스냅샷`, essay, version, versions: essay.versions });
  });

  router.get('/:id/compare', (req, res, next) => {
    const userId = req.session.user.id;
    const essay = getEssayById(db, userId, req.params.id);
    if (!essay) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));

    const defaultFrom = essay.versions.length > 1 ? essay.versions[1].version_no : essay.versions[0]?.version_no;
    const from = req.query.from !== undefined ? String(req.query.from).trim() : String(defaultFrom || '');
    const to = req.query.to !== undefined ? String(req.query.to).trim() : 'current';

    if (!from || Number.isNaN(Number(from)) || (to !== 'current' && Number.isNaN(Number(to)))) {
      return res.status(422).render('error', { title: '잘못된 비교 요청 (422)', status: 422, message: '비교할 버전 번호를 올바르게 선택해 주세요.' });
    }

    const comparison = compareEssayVersions(db, userId, { essayId: essay.id, from: Number(from), to });
    if (!comparison) return next(createHttpError(404, '비교할 버전을 찾을 수 없습니다.'));
    return res.render('essays/compare', { title: `${essay.title} — 버전 비교`, essay, versions: essay.versions, comparison });
  });

  router.post('/:id/versions/:no/restore', (req, res, next) => {
    const result = restoreEssayVersion(db, req.session.user.id, { essayId: req.params.id, versionNo: req.params.no });
    if (!result) return next(createHttpError(404, '복원할 버전을 찾을 수 없습니다.'));
    req.setFlash('success', `v${req.params.no} 버전이 복원되어 새 버전(v${result.restoredVersion.version_no})으로 기록되었습니다.`);
    return res.redirect(`/essays/${req.params.id}`);
  });

  router.post('/:id/materials/:materialId', (req, res, next) => {
    const linked = linkMaterialToEssay(db, req.session.user.id, { essayId: req.params.id, materialId: req.params.materialId });
    if (!linked) return next(createHttpError(404, '자기소개서 또는 경험 자료를 찾을 수 없습니다.'));
    if (req.get('Accept')?.includes('application/json')) return res.json({ linked: true, ...linked });
    req.setFlash('success', '경험 자료가 자기소개서에 연결되었습니다.');
    return res.redirect(`/essays/${req.params.id}?tab=materials`);
  });

  router.delete('/:id/materials/:materialId', (req, res, next) => {
    const unlinked = unlinkMaterialFromEssay(db, req.session.user.id, { essayId: req.params.id, materialId: req.params.materialId });
    if (!unlinked) return next(createHttpError(404, '자기소개서 또는 경험 자료를 찾을 수 없습니다.'));
    if (req.get('Accept')?.includes('application/json')) return res.json({ linked: false, ...unlinked });
    req.setFlash('success', '경험 자료 연결이 해제되었습니다.');
    return res.redirect(`/essays/${req.params.id}?tab=materials`);
  });

  router.delete('/:id', (req, res, next) => {
    if (!deleteEssay(db, req.session.user.id, req.params.id)) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    req.setFlash('success', '자기소개서가 삭제되었습니다.');
    return res.redirect('/essays');
  });

  return router;
}

function createEssaysApiRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.param('id', (req, res, next, v) => (req.params.id = parseId(v)) ? next() : res.status(404).json({ error: '요청한 자기소개서를 찾을 수 없습니다.' }));

  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const excludeEssayId = req.query.exclude_essay_id || req.query.exclude || req.query.essay_id || null;
    const rows = searchEssayQuestions(db, req.session.user.id, { q, excludeEssayId });
    const results = rows.map((r) => ({ ...r, snippet: r.answer.length > 160 ? `${r.answer.slice(0, 160)}...` : r.answer }));
    return res.json({ results });
  });

  router.put('/:id/draft', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getEssayById(db, userId, req.params.id);
    if (!existing) return next(createHttpError(404, '요청한 자기소개서를 찾을 수 없습니다.'));
    const rawAnswers = req.body.answers || req.body.questions;
    if (!Array.isArray(rawAnswers)) return res.status(422).json({ error: 'answers 배열이 필요합니다.' });
    try {
      const saved = saveEssayDraft(db, userId, { essayId: existing.id, title: req.body.title, answers: parseDraftAnswersFromBody(req.body, existing.questions) });
      return res.json({ saved_at: saved.saved_at, essay_id: saved.essay_id });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createEssaysRouter, createEssaysApiRouter };
