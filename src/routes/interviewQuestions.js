const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { parseId } = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const { getApplicationById } = require('../services/applicationsService');
const {
  list: listInterviewQuestions,
  createManual: createManualQuestion,
  deleteQuestion: deleteInterviewQuestion,
  generateAiQuestionsForApplication,
} = require('../services/interviewQuestionsService');
const {
  AI_DISABLED_MESSAGE,
  isAiEnabled,
  checkRateLimit,
} = require('../services/aiService');

function createInterviewQuestionsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.post('/:id/interview-questions', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    const application = getApplicationById(db, req.session.user.id, id);
    if (!application) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));

    const question = String(req.body.question || '').trim();
    if (!question || question.length > 500) {
      const interviewQuestions = listInterviewQuestions(db, req.session.user.id, id);
      return res.status(422).render('applications/detail', {
        title: `${application.company_name} — 지원 상세`,
        application: { ...application, interviewQuestions },
        interviewQuestions,
        aiEnabled: isAiEnabled(),
        questionError: '면접 질문을 1자 이상 500자 이하로 입력해 주세요.',
        manualQuestion: question,
      });
    }

    try {
      createManualQuestion(db, req.session.user.id, id, question);
      req.setFlash('success', '면접 질문이 등록되었습니다.');
      return res.redirect(`/applications/${id}`);
    } catch (err) {
      if (err.status === 422) {
        const interviewQuestions = listInterviewQuestions(db, req.session.user.id, id);
        return res.status(422).render('applications/detail', {
          title: `${application.company_name} — 지원 상세`,
          application: { ...application, interviewQuestions },
          interviewQuestions,
          aiEnabled: isAiEnabled(),
          questionError: err.message,
          manualQuestion: question,
        });
      }
      return next(err);
    }
  });

  router.delete('/:id/interview-questions/:qid', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    const qid = parseId(req.params.qid);
    if (!qid) return next(createHttpError(404, '요청한 면접 질문을 찾을 수 없습니다.'));

    const application = getApplicationById(db, req.session.user.id, id);
    if (!application) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));

    const existing = db
      .prepare('SELECT id FROM interview_questions WHERE id = ? AND user_id = ? AND application_id = ?')
      .get(qid, req.session.user.id, id);
    if (!existing) {
      return next(createHttpError(404, '요청한 면접 질문을 찾을 수 없습니다.'));
    }

    deleteInterviewQuestion(db, req.session.user.id, qid);
    req.setFlash('success', '면접 질문이 삭제되었습니다.');
    return res.redirect(`/applications/${id}`);
  });

  router.post('/:id/interview-questions/generate', async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    const application = getApplicationById(db, req.session.user.id, id);
    if (!application) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));

    if (!isAiEnabled()) {
      req.setFlash('error', AI_DISABLED_MESSAGE);
      return res.redirect(`/applications/${id}`);
    }

    const rateCheck = checkRateLimit(req.session.user.id);
    if (!rateCheck.allowed) {
      req.setFlash('error', rateCheck.message);
      const interviewQuestions = listInterviewQuestions(db, req.session.user.id, id);
      return res.status(429).render('applications/detail', {
        title: `${application.company_name} — 지원 상세`,
        application: { ...application, interviewQuestions },
        interviewQuestions,
        aiEnabled: isAiEnabled(),
        flash: { type: 'error', message: rateCheck.message },
        questionError: null,
        manualQuestion: '',
      });
    }

    try {
      const generatedQuestions = await generateAiQuestionsForApplication(db, req.session.user.id, application);
      req.setFlash('success', `AI 예상 면접 질문 ${generatedQuestions.length}개가 생성되었습니다.`);
      return res.redirect(`/applications/${id}`);
    } catch (err) {
      req.setFlash('error', err.message || 'AI 면접 질문 생성에 실패했습니다.');
      return res.redirect(`/applications/${id}`);
    }
  });

  return router;
}

module.exports = {
  createInterviewQuestionsRouter,
};
