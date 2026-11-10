const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  EMPLOYMENT_TYPES,
  isValidDate,
  isValidUrl,
} = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const { listCompanies, getCompanyById } = require('../services/companiesService');
const {
  listJobPosts,
  getJobPostById,
  createJobPostWithCompany,
  updateJobPost,
  toggleJobBookmark,
  deleteJobPost,
} = require('../services/jobsService');

function createJobsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const filters = {
      q: String(req.query.q || '').trim(),
      employment_type: String(req.query.employment_type || '').trim(),
      bookmarked: String(req.query.bookmarked || '').trim(),
      sort: String(req.query.sort || 'deadline').trim(),
    };
    const jobs = listJobPosts(db, req.session.user.id, filters);
    return res.render('jobs/index', {
      title: '채용 공고',
      jobs,
      filters,
    });
  });

  router.get('/new', (req, res) => {
    const companies = listCompanies(db, req.session.user.id);
    const preselectedCompanyId = req.query.company_id ? Number(req.query.company_id) : '';
    return res.render('jobs/form', {
      title: '채용 공고 등록',
      isEdit: false,
      error: null,
      companies,
      job: {
        company_id: preselectedCompanyId,
        new_company_name: '',
        new_company_industry: '',
        new_company_website: '',
        title: '',
        position: '',
        employment_type: 'new_grad',
        url: '',
        deadline: '',
        memo: '',
        is_bookmarked: 0,
      },
    });
  });

  router.post('/', (req, res, next) => {
    const userId = req.session.user.id;
    const companies = listCompanies(db, userId);

    const company_id = req.body.company_id ? Number(req.body.company_id) : '';
    const new_company_name = String(req.body.new_company_name || '').trim();
    const new_company_industry = String(req.body.new_company_industry || '').trim();
    const new_company_website = String(req.body.new_company_website || '').trim();
    const title = String(req.body.title || '').trim();
    const position = String(req.body.position || '').trim();
    const employment_type = String(req.body.employment_type || 'new_grad').trim();
    const url = String(req.body.url || '').trim();
    const deadline = String(req.body.deadline || '').trim();
    const memo = String(req.body.memo || '').trim();
    const is_bookmarked =
      req.body.is_bookmarked === '1' ||
      req.body.is_bookmarked === 'on' ||
      req.body.is_bookmarked === true
        ? 1
        : 0;

    const formValues = {
      company_id,
      new_company_name,
      new_company_industry,
      new_company_website,
      title,
      position,
      employment_type,
      url,
      deadline,
      memo,
      is_bookmarked,
    };

    const renderInvalid = (errorMessage) =>
      res.status(422).render('jobs/form', {
        title: '채용 공고 등록',
        isEdit: false,
        error: errorMessage,
        companies,
        job: formValues,
      });

    if (!title) {
      return renderInvalid('공고 제목을 입력해 주세요.');
    }

    if (!company_id && !new_company_name) {
      return renderInvalid('기존 기업을 선택하거나 새 기업명을 입력해 주세요.');
    }

    if (!EMPLOYMENT_TYPES.includes(employment_type)) {
      return renderInvalid('올바른 채용 형태를 선택해 주세요.');
    }

    if (!isValidDate(deadline)) {
      return renderInvalid('마감일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
    }

    if (!isValidUrl(url) || !isValidUrl(new_company_website)) {
      return renderInvalid('URL은 http:// 또는 https://로 시작해야 합니다.');
    }

    if (!new_company_name && company_id) {
      const ownedCompany = getCompanyById(db, userId, company_id);
      if (!ownedCompany) {
        return next(createHttpError(404, '선택한 기업을 찾을 수 없습니다.'));
      }
    }

    const created = createJobPostWithCompany(db, userId, formValues);
    req.setFlash('success', '채용 공고가 등록되었습니다.');
    return res.redirect(`/jobs/${created.id}`);
  });

  router.get('/:id', (req, res, next) => {
    const job = getJobPostById(db, req.session.user.id, req.params.id);
    if (!job) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    return res.render('jobs/detail', {
      title: `${job.title} — 채용 공고 상세`,
      job,
    });
  });

  router.get('/:id/edit', (req, res, next) => {
    const userId = req.session.user.id;
    const job = getJobPostById(db, userId, req.params.id);
    if (!job) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    const companies = listCompanies(db, userId);
    return res.render('jobs/form', {
      title: `${job.title} — 채용 공고 수정`,
      isEdit: true,
      error: null,
      companies,
      job,
    });
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getJobPostById(db, userId, req.params.id);
    if (!existing) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }

    const companies = listCompanies(db, userId);
    const company_id = req.body.company_id ? Number(req.body.company_id) : existing.company_id;
    const title = String(req.body.title || '').trim();
    const position = String(req.body.position || '').trim();
    const employment_type = String(
      req.body.employment_type || existing.employment_type || 'new_grad'
    ).trim();
    const url = String(req.body.url || '').trim();
    const deadline = String(req.body.deadline || '').trim();
    const memo = String(req.body.memo || '').trim();
    const is_bookmarked =
      req.body.is_bookmarked === undefined
        ? existing.is_bookmarked
        : req.body.is_bookmarked === '1' ||
            req.body.is_bookmarked === 'on' ||
            req.body.is_bookmarked === true
          ? 1
          : 0;

    const formValues = {
      id: existing.id,
      company_id,
      title,
      position,
      employment_type,
      url,
      deadline,
      memo,
      is_bookmarked,
    };

    const renderInvalid = (errorMessage) =>
      res.status(422).render('jobs/form', {
        title: '채용 공고 수정',
        isEdit: true,
        error: errorMessage,
        companies,
        job: formValues,
      });

    if (!title) {
      return renderInvalid('공고 제목을 입력해 주세요.');
    }

    if (!EMPLOYMENT_TYPES.includes(employment_type)) {
      return renderInvalid('올바른 채용 형태를 선택해 주세요.');
    }

    if (!isValidDate(deadline)) {
      return renderInvalid('마감일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
    }

    if (!isValidUrl(url)) {
      return renderInvalid('URL은 http:// 또는 https://로 시작해야 합니다.');
    }

    const ownedCompany = getCompanyById(db, userId, company_id);
    if (!ownedCompany) {
      return next(createHttpError(404, '선택한 기업을 찾을 수 없습니다.'));
    }

    updateJobPost(db, userId, existing.id, formValues);
    req.setFlash('success', '채용 공고가 수정되었습니다.');
    return res.redirect(`/jobs/${existing.id}`);
  });

  router.post('/:id/bookmark', (req, res, next) => {
    const updated = toggleJobBookmark(db, req.session.user.id, req.params.id);
    if (!updated) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }

    if (req.get('Accept') && req.get('Accept').includes('application/json')) {
      return res.json({ id: updated.id, is_bookmarked: updated.is_bookmarked });
    }

    req.setFlash(
      'success',
      updated.is_bookmarked ? '관심 공고로 북마크했습니다.' : '북마크를 해제했습니다.'
    );
    const redirectTo = req.body.redirect_to || `/jobs/${updated.id}`;
    return res.redirect(redirectTo);
  });

  router.delete('/:id', (req, res, next) => {
    const deleted = deleteJobPost(db, req.session.user.id, req.params.id);
    if (!deleted) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    req.setFlash('success', '채용 공고가 삭제되었습니다.');
    return res.redirect('/jobs');
  });

  return router;
}

module.exports = { createJobsRouter };
