const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createHttpError } = require('../middleware/error');
const { parseId, safeRedirectPath, isValidDate } = require('../middleware/validation');
const {
  SPEC_KINDS,
  SPEC_STATUSES,
  STATUS_LABELS,
  KIND_LABELS,
  BOARD_COLUMNS,
  SpecValidationError,
  formatSpecDate,
  createSpecItem,
  getSpecItem,
  listSpecItems,
  groupSpecBoard,
  updateSpecItem,
  updateSpecStatus,
  deleteSpecItem,
  getSpecLinks,
  specTimeline,
  addWatch,
  removeWatch,
  listWatches,
} = require('../services/specsService');

const NOT_FOUND = '요청한 스펙을 찾을 수 없습니다.';
const FORM_FIELDS = ['kind', 'title', 'organizer', 'source_url', 'status', 'apply_start', 'apply_end', 'event_date', 'end_date', 'result_date', 'memo'];

const viewLocals = { SPEC_KINDS, SPEC_STATUSES, STATUS_LABELS, SPEC_KIND_LABELS: KIND_LABELS, BOARD_COLUMNS, formatSpecDate };

function formValues(body = {}) {
  const values = {};
  for (const field of FORM_FIELDS) values[field] = body[field] === undefined ? '' : String(body[field]);
  return values;
}

function readFilters(query = {}) {
  const kind = String(query.kind || '').trim();
  const status = String(query.status || '').trim();
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  return {
    view: query.view === 'list' ? 'list' : 'board',
    kind: SPEC_KINDS.includes(kind) ? kind : '',
    status: SPEC_STATUSES.includes(status) ? status : '',
    q: String(query.q || '').trim().slice(0, 100),
    from: isValidDate(from) ? from : '',
    to: isValidDate(to) ? to : '',
  };
}

function automationMessage(automation) {
  if (!automation) return '';
  const parts = [];
  if (automation.eventsCreated > 0 || automation.todoCreated) parts.push('접수·시험 일정과 할 일이 자동으로 등록되었습니다.');
  if (automation.materialCreated) parts.push('경험 자료함에 초안이 만들어졌습니다.');
  if (automation.eventsRemoved > 0 || automation.todosRemoved > 0) parts.push('남은 일정과 할 일을 정리했습니다.');
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function createSpecsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  function renderIndex(req, res, { status = 200, watchError = null, watchForm = {} } = {}) {
    const userId = req.session.user.id;
    const filters = readFilters(req.query);
    const items = listSpecItems(db, userId, filters);
    return res.status(status).render('specs/index', {
      ...viewLocals,
      title: '스펙 관리',
      filters,
      items,
      columns: groupSpecBoard(items),
      watches: listWatches(db, userId),
      watchError,
      watchForm,
      redirectTo: req.method === 'GET' ? req.originalUrl : '/specs',
    });
  }

  function renderForm(res, { status = 200, isEdit, spec, error = null }) {
    return res.status(status).render('specs/form', {
      ...viewLocals,
      title: isEdit ? '스펙 수정' : '스펙 등록',
      isEdit,
      spec,
      error,
    });
  }

  function loadOwned(req, next) {
    const id = parseId(req.params.id);
    const spec = id ? getSpecItem(db, req.session.user.id, id) : null;
    if (!spec) next(createHttpError(404, NOT_FOUND));
    return spec;
  }

  function renderDetail(res, spec, error = null) {
    return res.status(error ? 422 : 200).render('specs/detail', {
      ...viewLocals,
      title: `${spec.title} — 스펙 상세`,
      spec,
      error,
      timeline: specTimeline(spec),
      links: getSpecLinks(db, spec.user_id, spec),
    });
  }

  router.get('/', (req, res) => renderIndex(req, res));

  router.get('/new', (req, res) => {
    const kind = SPEC_KINDS.includes(req.query.kind) ? req.query.kind : 'certificate';
    return renderForm(res, { isEdit: false, spec: { ...formValues(), kind, status: 'interested' } });
  });

  router.post('/', (req, res, next) => {
    const values = formValues(req.body);
    try {
      const created = createSpecItem(db, req.session.user.id, values);
      req.setFlash('success', `스펙이 등록되었습니다.${automationMessage(created.automation)}`);
      return res.redirect(`/specs/${created.id}`);
    } catch (err) {
      if (err instanceof SpecValidationError) return renderForm(res, { status: 422, isEdit: false, spec: values, error: err.message });
      return next(err);
    }
  });

  router.post('/watch', (req, res, next) => {
    const watchForm = { cert_code: String(req.body.cert_code || ''), cert_name: String(req.body.cert_name || '') };
    try {
      const { duplicate } = addWatch(db, req.session.user.id, watchForm);
      req.setFlash('success', duplicate ? '이미 구독 중인 자격증입니다.' : '관심 자격증 구독을 추가했습니다.');
      return res.redirect(safeRedirectPath(req.body.redirect_to, '/specs'));
    } catch (err) {
      if (err instanceof SpecValidationError) return renderIndex(req, res, { status: 422, watchError: err.message, watchForm });
      return next(err);
    }
  });

  router.delete('/watch/:code', (req, res, next) => {
    if (!removeWatch(db, req.session.user.id, req.params.code)) {
      return next(createHttpError(404, '구독 중인 자격증을 찾을 수 없습니다.'));
    }
    req.setFlash('success', '관심 자격증 구독을 해제했습니다.');
    return res.redirect(safeRedirectPath(req.body.redirect_to, '/specs'));
  });

  router.get('/:id', (req, res, next) => {
    const spec = loadOwned(req, next);
    if (!spec) return undefined;
    return renderDetail(res, spec);
  });

  router.get('/:id/edit', (req, res, next) => {
    const spec = loadOwned(req, next);
    if (!spec) return undefined;
    return renderForm(res, { isEdit: true, spec });
  });

  router.put('/:id', (req, res, next) => {
    const spec = loadOwned(req, next);
    if (!spec) return undefined;
    const values = formValues(req.body);
    try {
      const updated = updateSpecItem(db, req.session.user.id, spec.id, values);
      req.setFlash('success', `스펙이 수정되었습니다.${automationMessage(updated.automation)}`);
      return res.redirect(`/specs/${spec.id}`);
    } catch (err) {
      if (err instanceof SpecValidationError) {
        return renderForm(res, { status: 422, isEdit: true, spec: { ...values, id: spec.id }, error: err.message });
      }
      return next(err);
    }
  });

  router.post('/:id/status', (req, res, next) => {
    const spec = loadOwned(req, next);
    if (!spec) return undefined;
    try {
      const updated = updateSpecStatus(db, req.session.user.id, spec.id, req.body.status);
      req.setFlash('success', `진행 상태를 '${STATUS_LABELS[updated.status]}'(으)로 변경했습니다.${automationMessage(updated.automation)}`);
      return res.redirect(safeRedirectPath(req.body.redirect_to, `/specs/${spec.id}`));
    } catch (err) {
      if (err instanceof SpecValidationError) return renderDetail(res, spec, err.message);
      return next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id || !deleteSpecItem(db, req.session.user.id, id)) return next(createHttpError(404, NOT_FOUND));
    req.setFlash('success', '스펙과 자동 등록된 일정·할 일이 삭제되었습니다.');
    return res.redirect('/specs');
  });

  return router;
}

function createSpecsApiRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.patch('/:id/status', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: NOT_FOUND });
    try {
      const updated = updateSpecStatus(db, req.session.user.id, id, req.body && req.body.status);
      if (!updated) return res.status(404).json({ error: NOT_FOUND });
      const { automation, ...spec } = updated;
      return res.json({ ok: true, spec, automation, message: automationMessage(automation).trim() });
    } catch (err) {
      if (err instanceof SpecValidationError) return res.status(422).json({ error: err.message });
      return next(err);
    }
  });

  return router;
}

module.exports = { createSpecsRouter, createSpecsApiRouter };
