const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  APPLICATION_STAGES,
  APPLICATION_RESULTS,
  isValidDate,
} = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const { listJobPosts, getJobPostById } = require('../services/jobsService');
const {
  listApplications,
  getApplicationById,
  createApplication,
  updateApplication,
  patchApplicationStage,
  deleteApplication,
} = require('../services/applicationsService');

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
    return res.render('applications/index', {
      title: '지원 현황',
      applications,
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

    const job_post_id = req.body.job_post_id ? Number(req.body.job_post_id) : '';
    const stage = String(req.body.stage || 'document').trim();
    const result = String(req.body.result || 'in_progress').trim();
    const applied_at = String(req.body.applied_at || '').trim();
    const memo = String(req.body.memo || '').trim();

    const formValues = {
      job_post_id,
      stage,
      result,
      applied_at,
      memo,
    };

    const renderInvalid = (errorMessage) =>
      res.status(422).render('applications/form', {
        title: '지원 내역 등록',
        isEdit: false,
        error: errorMessage,
        jobs,
        application: formValues,
      });

    if (!job_post_id) {
      return renderInvalid('지원할 채용 공고를 선택해 주세요.');
    }

    if (!APPLICATION_STAGES.includes(stage)) {
      return renderInvalid('올바른 전형 단계를 선택해 주세요.');
    }

    if (!APPLICATION_RESULTS.includes(result)) {
      return renderInvalid('올바른 전형 결과를 선택해 주세요.');
    }

    if (!isValidDate(applied_at)) {
      return renderInvalid('지원일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
    }

    const ownedJob = getJobPostById(db, userId, job_post_id);
    if (!ownedJob) {
      return next(createHttpError(404, '선택한 채용 공고를 찾을 수 없습니다.'));
    }

    try {
      const created = createApplication(db, userId, formValues);
      req.setFlash('success', '지원 내역이 등록되었습니다.');
      return res.redirect(`/applications/${created.id}`);
    } catch (err) {
      if (err.code === 'DUPLICATE_APPLICATION') {
        return renderInvalid(err.message);
      }
      return next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    const application = getApplicationById(db, req.session.user.id, req.params.id);
    if (!application) {
      return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    }
    return res.render('applications/detail', {
      title: `${application.company_name} — 지원 상세`,
      application,
    });
  });

  router.get('/:id/edit', (req, res, next) => {
    const userId = req.session.user.id;
    const application = getApplicationById(db, userId, req.params.id);
    if (!application) {
      return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    }
    const jobs = listJobPosts(db, userId);
    return res.render('applications/form', {
      title: `${application.company_name} — 지원 내역 수정`,
      isEdit: true,
      error: null,
      jobs,
      application,
    });
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getApplicationById(db, userId, req.params.id);
    if (!existing) {
      return next(createHttpError(404, '요청한 지원 내역을 찾을 수 없습니다.'));
    }

    const jobs = listJobPosts(db, userId);
    const stage = String(req.body.stage || existing.stage).trim();
    const result = String(req.body.result || existing.result).trim();
    const applied_at = String(
      req.body.applied_at !== undefined ? req.body.applied_at : existing.applied_at || ''
    ).trim();
    const memo = String(
      req.body.memo !== undefined ? req.body.memo : existing.memo || ''
    ).trim();

    const formValues = {
      ...existing,
      stage,
      result,
      applied_at,
      memo,
    };

    const renderInvalid = (errorMessage) =>
      res.status(422).render('applications/form', {
        title: '지원 내역 수정',
        isEdit: true,
        error: errorMessage,
        jobs,
        application: formValues,
      });

    if (!APPLICATION_STAGES.includes(stage)) {
      return renderInvalid('올바른 전형 단계를 선택해 주세요.');
    }

    if (!APPLICATION_RESULTS.includes(result)) {
      return renderInvalid('올바른 전형 결과를 선택해 주세요.');
    }

    if (!isValidDate(applied_at)) {
      return renderInvalid('지원일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
    }

    updateApplication(db, userId, existing.id, {
      stage,
      result,
      applied_at,
      memo,
    });

    req.setFlash('success', '지원 내역이 수정되었습니다.');
    return res.redirect(`/applications/${existing.id}`);
  });

  router.delete('/:id', (req, res, next) => {
    const deleted = deleteApplication(db, req.session.user.id, req.params.id);
    if (!deleted) {
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
    const userId = req.session.user.id;
    const { stage, result, board_order } = req.body || {};

    if (!stage || !APPLICATION_STAGES.includes(String(stage))) {
      return res.status(422).json({
        error: '유효하지 않은 전형 단계(stage)입니다.',
      });
    }

    if (result !== undefined && result !== null && result !== '' && !APPLICATION_RESULTS.includes(String(result))) {
      return res.status(422).json({
        error: '유효하지 않은 전형 결과(result)입니다.',
      });
    }

    const updated = patchApplicationStage(db, userId, req.params.id, {
      stage: String(stage),
      result: result ? String(result) : undefined,
      board_order,
    });

    if (!updated) {
      return res.status(404).json({
        error: '요청한 지원 내역을 찾을 수 없습니다.',
      });
    }

    return res.json({
      id: updated.id,
      stage: updated.stage,
      result: updated.result,
      board_order: updated.board_order,
      application: updated,
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
