const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { isValidUrl } = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const {
  listCompanies,
  getCompanyById,
  getCompanyWithJobs,
  findCompanyByName,
  createCompany,
  updateCompany,
  deleteCompany,
} = require('../services/companiesService');

function createCompaniesRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const q = String(req.query.q || '').trim();
    const companies = listCompanies(db, req.session.user.id, { q });
    return res.render('companies/index', {
      title: '기업 관리',
      companies,
      q,
    });
  });

  router.get('/new', (req, res) => {
    return res.render('companies/form', {
      title: '기업 등록',
      isEdit: false,
      error: null,
      company: { name: '', industry: '', website: '', memo: '' },
    });
  });

  router.post('/', (req, res) => {
    const userId = req.session.user.id;
    const name = String(req.body.name || '').trim();
    const industry = String(req.body.industry || '').trim();
    const website = String(req.body.website || '').trim();
    const memo = String(req.body.memo || '').trim();
    const formValues = { name, industry, website, memo };

    if (!name) {
      return res.status(422).render('companies/form', {
        title: '기업 등록',
        isEdit: false,
        error: '기업명을 입력해 주세요.',
        company: formValues,
      });
    }

    if (!isValidUrl(website)) {
      return res.status(422).render('companies/form', {
        title: '기업 등록',
        isEdit: false,
        error: '웹사이트 주소는 http:// 또는 https://로 시작해야 합니다.',
        company: formValues,
      });
    }

    const existing = findCompanyByName(db, userId, name);
    if (existing) {
      return res.status(422).render('companies/form', {
        title: '기업 등록',
        isEdit: false,
        error: '이미 동일한 이름의 기업이 등록되어 있습니다.',
        company: formValues,
      });
    }

    const created = createCompany(db, userId, formValues);
    req.setFlash('success', '기업이 등록되었습니다.');
    return res.redirect(`/companies/${created.id}`);
  });

  router.get('/:id', (req, res, next) => {
    const company = getCompanyWithJobs(db, req.session.user.id, req.params.id);
    if (!company) {
      return next(createHttpError(404, '요청한 기업을 찾을 수 없습니다.'));
    }
    return res.render('companies/detail', {
      title: `${company.name} — 기업 상세`,
      company,
    });
  });

  router.get('/:id/edit', (req, res, next) => {
    const company = getCompanyById(db, req.session.user.id, req.params.id);
    if (!company) {
      return next(createHttpError(404, '요청한 기업을 찾을 수 없습니다.'));
    }
    return res.render('companies/form', {
      title: `${company.name} — 기업 수정`,
      isEdit: true,
      error: null,
      company,
    });
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getCompanyById(db, userId, req.params.id);
    if (!existing) {
      return next(createHttpError(404, '요청한 기업을 찾을 수 없습니다.'));
    }

    const name = String(req.body.name || '').trim();
    const industry = String(req.body.industry || '').trim();
    const website = String(req.body.website || '').trim();
    const memo = String(req.body.memo || '').trim();
    const formValues = { id: existing.id, name, industry, website, memo };

    if (!name) {
      return res.status(422).render('companies/form', {
        title: '기업 수정',
        isEdit: true,
        error: '기업명을 입력해 주세요.',
        company: formValues,
      });
    }

    if (!isValidUrl(website)) {
      return res.status(422).render('companies/form', {
        title: '기업 수정',
        isEdit: true,
        error: '웹사이트 주소는 http:// 또는 https://로 시작해야 합니다.',
        company: formValues,
      });
    }

    const duplicate = findCompanyByName(db, userId, name);
    if (duplicate && duplicate.id !== existing.id) {
      return res.status(422).render('companies/form', {
        title: '기업 수정',
        isEdit: true,
        error: '이미 동일한 이름의 기업이 등록되어 있습니다.',
        company: formValues,
      });
    }

    updateCompany(db, userId, existing.id, formValues);
    req.setFlash('success', '기업 정보가 수정되었습니다.');
    return res.redirect(`/companies/${existing.id}`);
  });

  router.delete('/:id', (req, res, next) => {
    const deleted = deleteCompany(db, req.session.user.id, req.params.id);
    if (!deleted) {
      return next(createHttpError(404, '요청한 기업을 찾을 수 없습니다.'));
    }
    req.setFlash('success', '기업이 삭제되었습니다.');
    return res.redirect('/companies');
  });

  return router;
}

module.exports = { createCompaniesRouter };
