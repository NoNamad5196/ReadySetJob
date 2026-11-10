const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { APPLICATION_STAGES, APPLICATION_RESULTS, isValidDate } = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const { listJobPosts, getJobPostById } = require('../services/jobsService');
const {
  listApplications,
  listBoardApplications,
  getApplicationById,
  createApplication,
  updateApplication,
  moveApplication,
  patchApplicationStage,
  deleteApplication,
} = require('../services/applicationsService');

function validateApplicationFormInput({ stage, result, applied_at }) {
  if (!APPLICATION_STAGES.includes(stage)) return '올바른 전형 단계를 선택해 주세요.';
  if (!APPLICATION_RESULTS.includes(result)) return '올바른 전형 결과를 선택해 주세요.';
  if (!isValidDate(applied_at)) return '지원일 형식이 올바르지 않습니다 (YYYY-MM-DD).';
  return null;
}

function parseStagePayload(body = {}) {
  const stage = String(body.stage || '').trim();
  const result = body.result !== undefined && body.result !== null && body.result !== '' ? String(body.result).trim() : undefined;
  if (!stage || !APPLICATION_STAGES.includes(stage)) {
    return { error: '유효하지 않은 전형 단계(stage)입니다.' };
  }
  if (result !== undefined && !APPLICATION_RESULTS.includes(result)) {
    return { error: '유효하지 않은 전형 결과(result)입니다.' };
  }
  let parsedIndex;
  if (body.index !== undefined && body.index !== null && body.index !== '') {
    parsedIndex = Number(body.index);
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
      return { error: '유효하지 않은 순서(index)입니다.' };
    }
  }
  return { stage, result, parsedIndex, board_order: body.board_order };
}

function createApplicationsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const filters = {
      stage: String(req.query.stage || '').trim(),
      result: String(req.query.result || '').trim(),
      q: String(req.query.q || '').trim(),
    };
    const applications = listApplications(db, req.session.user.id, filters);
    return res.render('applications/index', { title: '지원 현황', applications, filters });
  });

  router.get('/board', (req, res) => {
    const rawResult = String(req.query.result || '').trim();
    const filters = {
      result: APPLICATION_RESULTS.includes(rawResult) ? rawResult : '',
      q: String(req.query.q || '').trim(),
    };
    const { applications, columns } = listBoardApplications(db, req.session.user.id, filters);
    return res.render('applications/board', {
      title: '지원 현황 보드',
      applications,
      columns,
      filters,
    });
  });

  router.get('/new', (req, res) => {
    const jobs = listJobPosts(db, req.session.user.id);
    const preselectedJobId = req.query.job_post_id ? Number(req.query.job_post_id) : '';
    const today = new Date().toISOString().slice(0, 10);

    return res.render('applications/form', {
      title: '지원 내역 등록',
      isEdit: false,
      error: null,
      jobs,
      application: {
        job_post_id: preselectedJobId,
        stage: 'document',
        result: 'in_progress',
        applied_at: today,
        memo: '',
      },
    });
  });

  router.post('/', (req, res, next) => {
    const userId = req.session.user.id;
    const jobs = listJobPosts(db, userId);
    const formValues = {
      job_post_id: req.body.job_post_id ? Number(req.body.job_post_id) : '',
      stage: String(req.body.stage || 'document').trim(),
      result: String(req.body.result || 'in_progress').trim(),
      applied_at: String(req.body.applied_at || '').trim(),
      memo: String(req.body.memo || '').trim(),
    };
    const renderInvalid = (error) =>
      res.status(422).render('applications/form', {
        title: '지원 내역 등록',
        isEdit: false,
        error,
        jobs,
        application: formValues,
      });

    if (!formValues.job_post_id) return renderInvalid('지원할 채용 공고를 선택해 주세요.');
    const fieldError = validateApplicationFormInput(formValues);
    if (fieldError) return renderInvalid(fieldError);

    if (!getJobPostById(db, userId, formValues.job_post_id)) {
      return next(createHttpError(404, '선택한 채용 공고를 찾을 수 없습니다.'));
    }

    try {
      const created = createApplication(db, userId, formValues);
      req.setFlash('success', '지원 내역이 등록되었습니다.');
      return res.redirect(`/applications/${created.id}`);
    } catch (err) {
      if (err.code === 'DUPLICATE_APPLICATION') return renderInvalid(err.message);
      return next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    const application = getApplicationById(db, req.session.user.id, req.params.id);
    if (!application) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    return res.render('applications/detail', {
      title: `${application.company_name} — 지원 상세`,
      application,
    });
  });

  router.get('/:id/edit', (req, res, next) => {
    const userId = req.session.user.id;
    const application = getApplicationById(db, userId, req.params.id);
    if (!application) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    return res.render('applications/form', {
      title: `${application.company_name} — 지원 내역 수정`,
      isEdit: true,
      error: null,
      jobs: listJobPosts(db, userId),
      application,
    });
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getApplicationById(db, userId, req.params.id);
    if (!existing) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));

    const formValues = {
      ...existing,
      stage: String(req.body.stage || existing.stage).trim(),
      result: String(req.body.result || existing.result).trim(),
      applied_at: String(req.body.applied_at !== undefined ? req.body.applied_at : existing.applied_at || '').trim(),
      memo: String(req.body.memo !== undefined ? req.body.memo : existing.memo || '').trim(),
    };

    const fieldError = validateApplicationFormInput(formValues);
    if (fieldError) {
      return res.status(422).render('applications/form', {
        title: '지원 내역 수정',
        isEdit: true,
        error: fieldError,
        jobs: listJobPosts(db, userId),
        application: formValues,
      });
    }

    updateApplication(db, userId, existing.id, formValues);
    req.setFlash('success', '지원 내역이 수정되었습니다.');
    return res.redirect(`/applications/${existing.id}`);
  });

  router.post('/:id/stage', (req, res, next) => {
    const parsed = parseStagePayload(req.body);
    if (parsed.error) return next(createHttpError(422, parsed.error));

    const updated = moveApplication(
      db,
      req.session.user.id,
      req.params.id,
      parsed.stage,
      parsed.parsedIndex,
      parsed.result
    );
    if (!updated) return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));

    req.setFlash('success', '전형 단계가 변경되었습니다.');
    return res.redirect('/applications/board');
  });

  router.delete('/:id', (req, res, next) => {
    if (!deleteApplication(db, req.session.user.id, req.params.id)) {
      return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    }
    req.setFlash('success', '지원 내역이 삭제되었습니다.');
    return res.redirect('/applications');
  });

  return router;
}

function createApplicationsApiRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.patch('/:id/stage', (req, res) => {
    const parsed = parseStagePayload(req.body);
    if (parsed.error) return res.status(422).json({ error: parsed.error });

    const updated = patchApplicationStage(db, req.session.user.id, req.params.id, {
      stage: parsed.stage,
      result: parsed.result,
      index: parsed.parsedIndex,
      board_order: parsed.board_order,
    });
    if (!updated) return res.status(404).json({ error: '요청한 지원 내역을 찾을 수 없습니다.' });

    return res.json({
      ok: true,
      id: updated.id,
      stage: updated.stage,
      result: updated.result,
      board_order: updated.board_order,
      application: {
        id: updated.id,
        stage: updated.stage,
        result: updated.result,
        board_order: updated.board_order,
        ...updated,
      },
      stageLogs: updated.stageLogs,
      stage_logs: updated.stageLogs,
    });
  });

  return router;
}

module.exports = {
  createApplicationsRouter,
  createApplicationsApiRouter,
};
