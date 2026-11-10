const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  EMPLOYMENT_TYPES,
  isValidDate,
  isValidUrl,
  safeRedirectPath,
  parseId,
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

function extractJobValues(body, existing = {}) {
  const isBm = body.is_bookmarked;
  return {
    title: String(body.title || '').trim(),
    position: String(body.position || '').trim(),
    employment_type: String(body.employment_type || existing.employment_type || 'new_grad').trim(),
    url: String(body.url || '').trim(),
    deadline: String(body.deadline || '').trim(),
    memo: String(body.memo || '').trim(),
    is_bookmarked:
      isBm === undefined
        ? (existing.is_bookmarked || 0)
        : isBm === '1' || isBm === 'on' || isBm === true
          ? 1
          : 0,
  };
}

function validateJobFields({ title, employment_type, deadline, url }) {
  if (!title) return '공고 제목을 입력해 주세요.';
  if (!EMPLOYMENT_TYPES.includes(employment_type)) return '올바른 채용 형태를 선택해 주세요.';
  if (!isValidDate(deadline)) return '마감일 형식이 올바르지 않습니다 (YYYY-MM-DD).';
  if (!isValidUrl(url)) return 'URL은 http:// 또는 https://로 시작해야 합니다.';
  return null;
}

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
      job: { company_id: preselectedCompanyId, new_company_name: '', new_company_industry: '', new_company_website: '', title: '', position: '', employment_type: 'new_grad', url: '', deadline: '', memo: '', is_bookmarked: 0 },
    });
  });

  router.post('/', (req, res, next) => {
    const userId = req.session.user.id;
    const companies = listCompanies(db, userId);

    let company_id = '';
    const rawCompanyId = req.body.company_id;
    if (rawCompanyId !== undefined && rawCompanyId !== null && String(rawCompanyId).trim() !== '') {
      company_id = parseId(rawCompanyId);
      if (!company_id) {
        return res.status(422).render('jobs/form', {
          title: '채용 공고 등록',
          isEdit: false,
          error: '올바른 기업을 선택해 주세요.',
          companies,
          job: req.body,
        });
      }
    }
    const baseValues = extractJobValues(req.body);
    const new_company_name = String(req.body.new_company_name || '').trim();
    const new_company_industry = String(req.body.new_company_industry || '').trim();
    const new_company_website = String(req.body.new_company_website || '').trim();

    const formValues = {
      ...baseValues,
      company_id,
      new_company_name,
      new_company_industry,
      new_company_website,
    };

    const renderInvalid = (errorMessage) =>
      res.status(422).render('jobs/form', {
        title: '채용 공고 등록',
        isEdit: false,
        error: errorMessage,
        companies,
        job: formValues,
      });

    const fieldError = validateJobFields(formValues);
    if (fieldError) return renderInvalid(fieldError);

    if (!company_id && !new_company_name) {
      return renderInvalid('기존 기업을 선택하거나 새 기업명을 입력해 주세요.');
    }

    if (!isValidUrl(new_company_website)) {
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
    const id = parseId(req.params.id);
    if (!id) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    const job = getJobPostById(db, req.session.user.id, id);
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
    const id = parseId(req.params.id);
    if (!id) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    const job = getJobPostById(db, userId, id);
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
    const id = parseId(req.params.id);
    if (!id) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    const existing = getJobPostById(db, userId, id);
    if (!existing) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }

    const companies = listCompanies(db, userId);
    let company_id = existing.company_id;
    const rawCompanyId = req.body.company_id;
    if (rawCompanyId !== undefined && rawCompanyId !== null && String(rawCompanyId).trim() !== '') {
      company_id = parseId(rawCompanyId);
      if (!company_id) {
        return res.status(422).render('jobs/form', {
          title: '채용 공고 수정',
          isEdit: true,
          error: '올바른 기업을 선택해 주세요.',
          companies,
          job: { ...existing, ...req.body },
        });
      }
    }
    const baseValues = extractJobValues(req.body, existing);
    const formValues = {
      id: existing.id,
      company_id,
      ...baseValues,
    };

    const renderInvalid = (errorMessage) =>
      res.status(422).render('jobs/form', {
        title: '채용 공고 수정',
        isEdit: true,
        error: errorMessage,
        companies,
        job: formValues,
      });

    const fieldError = validateJobFields(formValues);
    if (fieldError) return renderInvalid(fieldError);

    const ownedCompany = getCompanyById(db, userId, company_id);
    if (!ownedCompany) {
      return next(createHttpError(404, '선택한 기업을 찾을 수 없습니다.'));
    }

    updateJobPost(db, userId, existing.id, formValues);
    req.setFlash('success', '채용 공고가 수정되었습니다.');
    return res.redirect(`/jobs/${existing.id}`);
  });

  router.post('/:id/bookmark', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    const updated = toggleJobBookmark(db, req.session.user.id, id);
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
    const redirectTo = safeRedirectPath(req.body.redirect_to, `/jobs/${updated.id}`);
    return res.redirect(redirectTo);
  });

  router.delete('/:id', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    const deleted = deleteJobPost(db, req.session.user.id, id);
    if (!deleted) {
      return next(createHttpError(404, '요청한 채용 공고를 찾을 수 없습니다.'));
    }
    req.setFlash('success', '채용 공고가 삭제되었습니다.');
    return res.redirect('/jobs');
  });

  return router;
}

module.exports = { createJobsRouter };
