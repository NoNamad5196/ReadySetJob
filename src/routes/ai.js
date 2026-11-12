const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  parseId,
  calculateDday,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
} = require('../middleware/validation');
const { companyAvatar } = require('../utils/avatar');
const { createHttpError } = require('../middleware/error');
const {
  AI_DISABLED_MESSAGE,
  isAiEnabled,
  checkRateLimit,
  generateEssayFeedback,
  generateMaterialStarDraft,
  parseJobPostingText,
  searchJobPostings,
  generateWeeklyBriefing,
} = require('../services/aiService');
const {
  toIsoDate,
  buildBriefingContext,
  getBriefingForDate,
  saveBriefing,
} = require('../services/aiBriefingService');
const {
  getOwnedEssayQuestionContext,
  saveEssayFeedback,
  getLatestEssayFeedback,
  getOwnedMaterial,
  saveMaterialStarDraft,
  getLatestMaterialStarDraft,
  applyMaterialStarDraft,
} = require('../services/aiFeaturesService');
const { getMaterialWithEssays } = require('../services/materialsService');

function wantsJson(req) {
  return (
    req.originalUrl.startsWith('/api/') ||
    Boolean(req.get('Accept') && req.get('Accept').includes('application/json'))
  );
}

const SEARCH_CAREERS = ['new_grad', 'intern', 'experienced', 'any'];

function readSearchForm(body = {}) {
  const pick = (key, max) => (typeof body[key] === 'string' ? body[key].trim().slice(0, max) : '');
  const career = pick('career', 20);
  return {
    keyword: pick('keyword', 100),
    location: pick('location', 60),
    career: SEARCH_CAREERS.includes(career) ? career : 'any',
    extra: pick('extra', 300),
  };
}

function decorateSearchResult(item) {
  const avatar = companyAvatar(item.company_name);
  const dday = calculateDday(item.deadline);
  const registerType = EMPLOYMENT_TYPES.includes(item.employment_type) ? item.employment_type : 'other';
  const memoParts = [item.summary, item.location ? `근무 지역: ${item.location}` : '', `AI 웹 검색 출처: ${item.url}`];
  return {
    ...item,
    avatar: { initial: avatar.initial, className: avatar.className },
    dday: { label: dday.label, state: dday.state },
    employment_label: EMPLOYMENT_TYPE_LABELS[item.employment_type] || '형태 미상',
    register_employment_type: registerType,
    register_memo: memoParts.filter(Boolean).join('\n'),
  };
}

async function runJobSearch(userId, form) {
  if (!isAiEnabled()) return { status: 503, error: AI_DISABLED_MESSAGE };
  if (!form.keyword) return { status: 422, error: '검색할 직무 또는 키워드를 입력해 주세요.' };
  const rateCheck = checkRateLimit(userId);
  if (!rateCheck.allowed) return { status: 429, error: rateCheck.message };
  try {
    const { results, citations, model } = await searchJobPostings(form);
    return { status: 200, results: results.map(decorateSearchResult), citations, model };
  } catch (err) {
    return { status: err.status || 502, error: err.message || 'AI 공고 검색에 실패했습니다.' };
  }
}

// Mounted before the /jobs router so "/jobs/discover" is not captured by "/jobs/:id".
function createJobDiscoverRouter() {
  const router = express.Router();
  const render = (res, status, locals) =>
    res.status(status).render('jobs/discover', {
      title: 'AI 공고 찾기',
      form: { keyword: '', location: '', career: 'any', extra: '' },
      results: null,
      citations: [],
      error: null,
      ...locals,
    });

  router.get('/jobs/discover', requireAuth, (req, res) => render(res, 200, {}));

  router.post('/jobs/discover', requireAuth, async (req, res) => {
    const form = readSearchForm(req.body);
    const outcome = await runJobSearch(req.session.user.id, form);
    if (outcome.status !== 200) return render(res, outcome.status, { form, error: outcome.error });
    return render(res, 200, { form, results: outcome.results, citations: outcome.citations });
  });

  return router;
}

function createAiRouter(db) {
  const router = express.Router();
  router.use(requireAuth);
  const briefingInFlight = new Map();

  router.post('/api/jobs/search', async (req, res) => {
    const outcome = await runJobSearch(req.session.user.id, readSearchForm(req.body));
    if (outcome.status !== 200) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(200).json({ ok: true, model: outcome.model, results: outcome.results, citations: outcome.citations });
  });

  router.get('/api/briefing', (req, res) => {
    const briefing = getBriefingForDate(db, req.session.user.id, toIsoDate(new Date()));
    return res.status(200).json({ ok: true, enabled: isAiEnabled(), briefing: briefing || null });
  });

  router.post('/api/briefing', async (req, res) => {
    const userId = req.session.user.id;
    if (!isAiEnabled()) return res.status(503).json({ error: AI_DISABLED_MESSAGE });

    const now = new Date();
    const dateStr = toIsoDate(now);
    const rawForce = req.body && req.body.force;
    const force = rawForce === true || rawForce === 1 || rawForce === '1' || rawForce === 'true';
    const cached = getBriefingForDate(db, userId, dateStr);
    if (cached && !force) return res.status(200).json({ ok: true, cached: true, briefing: cached });

    const inflightKey = `${userId}:${dateStr}`;
    if (briefingInFlight.has(inflightKey)) {
      return res.status(409).json({ error: 'AI 브리핑을 생성하는 중입니다. 잠시 후 다시 확인해 주세요.' });
    }

    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) return res.status(429).json({ error: rateCheck.message });

    briefingInFlight.set(inflightKey, true);
    try {
      const { context, allowedHrefs } = buildBriefingContext(db, userId, now);
      const { result, model } = await generateWeeklyBriefing(context, { allowedHrefs });
      const saved = saveBriefing(db, userId, { dateStr, model, result });
      return res.status(200).json({ ok: true, cached: false, briefing: saved });
    } catch (err) {
      return res.status(err.status || 502).json({ error: err.message || 'AI 브리핑 생성에 실패했습니다.' });
    } finally {
      briefingInFlight.delete(inflightKey);
    }
  });

  // GET /api/essays/:id/questions/:qid/feedback — latest saved feedback for question
  router.get('/api/essays/:id/questions/:qid/feedback', (req, res) => {
    const essayId = parseId(req.params.id);
    const questionId = parseId(req.params.qid);
    if (!essayId || !questionId) {
      return res.status(404).json({ error: '요청한 자기소개서 문항을 찾을 수 없습니다.' });
    }

    const { owned, feedback } = getLatestEssayFeedback(db, req.session.user.id, {
      essayId,
      questionId,
    });
    if (!owned) {
      return res.status(404).json({ error: '요청한 자기소개서 문항을 찾을 수 없습니다.' });
    }

    return res.status(200).json({
      ok: true,
      feedback: feedback || null,
      ...(feedback && feedback.result ? feedback.result : {}),
    });
  });

  // POST /api/essays/:id/questions/:qid/feedback — generate and store essay feedback
  router.post('/api/essays/:id/questions/:qid/feedback', async (req, res) => {
    const userId = req.session.user.id;
    const essayId = parseId(req.params.id);
    const questionId = parseId(req.params.qid);
    if (!essayId || !questionId) {
      return res.status(404).json({ error: '요청한 자기소개서 문항을 찾을 수 없습니다.' });
    }

    const ctx = getOwnedEssayQuestionContext(db, userId, essayId, questionId);
    if (!ctx) {
      return res.status(404).json({ error: '요청한 자기소개서 문항을 찾을 수 없습니다.' });
    }

    if (!isAiEnabled()) {
      return res.status(503).json({ error: AI_DISABLED_MESSAGE });
    }

    const hasOverrideAnswer =
      req.body && req.body.answer !== undefined && req.body.answer !== null;
    if (hasOverrideAnswer && typeof req.body.answer === 'string' && req.body.answer.length > 5000) {
      return res.status(422).json({ error: '답변은 5000자 이하여야 합니다.' });
    }

    const rawAnswer = hasOverrideAnswer ? String(req.body.answer) : String(ctx.answer || '');
    if (rawAnswer.length > 5000) {
      return res.status(422).json({ error: '답변은 5000자 이하여야 합니다.' });
    }
    const answer = rawAnswer.trim();
    if (!answer) {
      return res.status(422).json({ error: '피드백을 생성할 답변 내용을 먼저 입력해 주세요.' });
    }

    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.message });
    }

    const jobMemo = [ctx.application_memo, ctx.job_memo].filter(Boolean).join('\n');

    try {
      const { result, model } = await generateEssayFeedback({
        question: ctx.question,
        charLimit: ctx.char_limit,
        answer,
        companyName: ctx.company_name,
        jobTitle: ctx.job_title,
        position: ctx.job_position,
        jobMemo,
      });

      const saved = saveEssayFeedback(db, userId, {
        essayId: ctx.essay_id,
        questionId: ctx.question_id,
        model,
        result,
      });

      return res.status(200).json({
        ok: true,
        feedback: saved,
        model,
        ...result,
      });
    } catch (err) {
      return res.status(err.status || 502).json({
        error: err.message || 'AI 자기소개서 피드백 생성에 실패했습니다.',
      });
    }
  });

  // GET /api/materials/:id/star-draft — latest saved STAR draft for material
  router.get('/api/materials/:id/star-draft', (req, res) => {
    const materialId = parseId(req.params.id);
    if (!materialId) {
      return res.status(404).json({ error: '요청한 자료를 찾을 수 없습니다.' });
    }

    const { owned, draft } = getLatestMaterialStarDraft(db, req.session.user.id, materialId);
    if (!owned) {
      return res.status(404).json({ error: '요청한 자료를 찾을 수 없습니다.' });
    }

    return res.status(200).json({
      ok: true,
      draft: draft || null,
      ...(draft && draft.result ? draft.result : {}),
    });
  });

  // Shared handler for POST /materials/:id/star-draft (form) and POST /api/materials/:id/star-draft (JSON)
  async function handleCreateStarDraft(req, res, next) {
    const userId = req.session.user.id;
    const isJson = wantsJson(req);
    const materialId = parseId(req.params.id);
    if (!materialId) {
      if (isJson) return res.status(404).json({ error: '요청한 자료를 찾을 수 없습니다.' });
      return next(createHttpError(404, '요청한 자료를 찾을 수 없습니다.'));
    }

    const material = getOwnedMaterial(db, userId, materialId);
    if (!material) {
      if (isJson) return res.status(404).json({ error: '요청한 자료를 찾을 수 없습니다.' });
      return next(createHttpError(404, '요청한 자료를 찾을 수 없습니다.'));
    }

    if (!isAiEnabled()) {
      if (isJson) {
        return res.status(503).json({ error: AI_DISABLED_MESSAGE });
      }
      req.setFlash('error', AI_DISABLED_MESSAGE);
      return res.redirect(`/materials/${material.id}`);
    }

    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      if (isJson) {
        return res.status(429).json({ error: rateCheck.message });
      }
      req.setFlash('error', rateCheck.message);
      const hydrated = getMaterialWithEssays(db, userId, material.id);
      return res.status(429).render('materials/detail', {
        title: `${material.title} — 자료 상세`,
        material: hydrated,
        flash: { type: 'error', message: rateCheck.message },
      });
    }

    const targetQuestion = String(
      (req.body && (req.body.target_question || req.body.targetQuestion)) || ''
    )
      .trim()
      .slice(0, 500);

    try {
      const { result, model } = await generateMaterialStarDraft({
        title: material.title,
        kind: material.kind,
        period: material.period,
        content: material.content,
        tags: material.tags,
        targetQuestion,
      });

      const saved = saveMaterialStarDraft(db, userId, {
        materialId: material.id,
        model,
        result,
      });

      if (isJson) {
        return res.status(200).json({
          ok: true,
          draft: saved,
          model,
          ...result,
        });
      }

      req.setFlash('success', 'AI STAR 구조 초안이 생성되었습니다.');
      return res.redirect(`/materials/${material.id}`);
    } catch (err) {
      if (isJson) {
        return res.status(err.status || 502).json({
          error: err.message || 'AI STAR 초안 생성에 실패했습니다.',
        });
      }
      req.setFlash('error', err.message || 'AI STAR 초안 생성에 실패했습니다.');
      return res.redirect(`/materials/${material.id}`);
    }
  }

  router.post('/materials/:id/star-draft', handleCreateStarDraft);
  router.post('/api/materials/:id/star-draft', handleCreateStarDraft);

  // POST /materials/:id/star-draft/:draftId/apply (and /api/materials/:id/star-draft/:draftId/apply)
  function handleApplyStarDraft(req, res, next) {
    const userId = req.session.user.id;
    const isJson = wantsJson(req);
    const materialId = parseId(req.params.id);
    const draftId = parseId(req.params.draftId);
    if (!materialId || !draftId) {
      if (isJson) return res.status(404).json({ error: '적용할 STAR 초안을 찾을 수 없습니다.' });
      return next(createHttpError(404, '적용할 STAR 초안을 찾을 수 없습니다.'));
    }

    const applied = applyMaterialStarDraft(db, userId, { materialId, draftId });
    if (!applied) {
      if (isJson) return res.status(404).json({ error: '적용할 STAR 초안을 찾을 수 없습니다.' });
      return next(createHttpError(404, '적용할 STAR 초안을 찾을 수 없습니다.'));
    }

    if (isJson) {
      return res.status(200).json({
        ok: true,
        material: applied.material,
        draft: applied.draft,
        appendedBlock: applied.appendedBlock,
      });
    }

    req.setFlash('success', 'STAR 초안이 자료 상세 내용에 추가되었습니다.');
    return res.redirect(`/materials/${materialId}`);
  }

  router.post('/materials/:id/star-draft/:draftId/apply', handleApplyStarDraft);
  router.post('/api/materials/:id/star-draft/:draftId/apply', handleApplyStarDraft);

  // POST /api/jobs/parse — extract structured fields from raw job posting text (not saved to DB)
  router.post('/api/jobs/parse', async (req, res) => {
    const userId = req.session.user.id;

    if (!isAiEnabled()) {
      return res.status(503).json({ error: AI_DISABLED_MESSAGE });
    }

    const rawText = req.body && typeof req.body.text === 'string' ? req.body.text : '';
    const trimmed = rawText.trim();
    if (!trimmed) {
      return res.status(422).json({ error: '추출할 채용 공고 텍스트를 입력해 주세요.' });
    }
    if (rawText.length > 12000) {
      return res.status(422).json({ error: '채용 공고 텍스트는 12000자 이하여야 합니다.' });
    }

    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.message });
    }

    try {
      const { result, model } = await parseJobPostingText({ text: trimmed });
      return res.status(200).json({
        ok: true,
        parsed: result,
        model,
        ...result,
      });
    } catch (err) {
      return res.status(err.status || 502).json({
        error: err.message || 'AI 채용 공고 분석에 실패했습니다.',
      });
    }
  });

  return router;
}

module.exports = { createAiRouter, createJobDiscoverRouter };
