const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  TODO_CATEGORIES,
  safeRedirectPath,
  parseId,
} = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const { listApplications, getApplicationById } = require('../services/applicationsService');
const {
  normalizeFilter,
  validateTodoFields,
  listTodos,
  getTodoById,
  createTodo,
  updateTodo,
  setTodoDone,
  toggleTodo,
  deleteTodo,
} = require('../services/todosService');

function parseOptionalAppId(rawAppId) {
  if (rawAppId === undefined || rawAppId === null || String(rawAppId).trim() === '') {
    return { value: null };
  }
  const parsed = parseId(rawAppId);
  if (!parsed) {
    return { error: '올바른 지원 내역을 선택해 주세요.' };
  }
  return { value: parsed };
}

function parseBooleanDone(val) {
  if (typeof val === 'boolean') return { value: val ? 1 : 0 };
  if (val === 1 || val === '1' || val === 'true') return { value: 1 };
  if (val === 0 || val === '0' || val === 'false') return { value: 0 };
  return { error: '유효하지 않은 완료 상태(is_done)입니다.' };
}

function createTodosRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  function renderTodosPage(req, res, { status = 200, error = null, values = null } = {}) {
    const userId = req.session.user.id;
    const rawFilter = String(req.query.filter || req.query.status || 'all').trim();
    const filter = normalizeFilter(rawFilter);
    const rawCategory = String(req.query.category || '').trim();
    const category = TODO_CATEGORIES.includes(rawCategory) ? rawCategory : '';

    const todos = listTodos(db, userId, { filter, category });
    const applications = listApplications(db, userId);

    return res.status(status).render('todos/index', {
      title: '할 일 관리',
      todos,
      applications,
      filters: { filter, category },
      error,
      values: values || {
        title: '',
        category: 'other',
        due_date: '',
        application_id: req.query.application_id || '',
      },
    });
  }

  router.get('/', (req, res) => renderTodosPage(req, res));

  router.post('/', (req, res, next) => {
    const userId = req.session.user.id;
    const title = String(req.body.title || '').trim();
    const category = String(req.body.category || 'other').trim();
    const due_date = String(req.body.due_date || '').trim();
    const redirectTo = safeRedirectPath(req.body.redirect_to, '/todos');

    const appIdParsed = parseOptionalAppId(req.body.application_id);
    if (appIdParsed.error) {
      return renderTodosPage(req, res, {
        status: 422,
        error: appIdParsed.error,
        values: { title, category, due_date, application_id: '' },
      });
    }

    const fieldError = validateTodoFields({ title, category, due_date });
    if (fieldError) {
      return renderTodosPage(req, res, {
        status: 422,
        error: fieldError,
        values: { title, category, due_date, application_id: appIdParsed.value || '' },
      });
    }

    if (appIdParsed.value && !getApplicationById(db, userId, appIdParsed.value)) {
      return next(createHttpError(404, '연결할 지원 내역을 찾을 수 없습니다.'));
    }

    try {
      createTodo(db, userId, {
        title,
        category,
        due_date: due_date || null,
        application_id: appIdParsed.value,
      });
      req.setFlash('success', '할 일이 등록되었습니다.');
      return res.redirect(redirectTo);
    } catch (err) {
      return next(err);
    }
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const id = parseId(req.params.id);
    if (!id) return next(createHttpError(404, '요청한 할 일을 찾을 수 없습니다.'));

    const existing = getTodoById(db, userId, id);
    if (!existing) return next(createHttpError(404, '요청한 할 일을 찾을 수 없습니다.'));

    const title = req.body.title !== undefined ? String(req.body.title).trim() : existing.title;
    const category = req.body.category !== undefined ? String(req.body.category).trim() : existing.category;
    const due_date = req.body.due_date !== undefined ? String(req.body.due_date).trim() : (existing.due_date || '');
    const redirectTo = safeRedirectPath(req.body.redirect_to, '/todos');

    let nextAppId = existing.application_id;
    if (req.body.application_id !== undefined) {
      const appIdParsed = parseOptionalAppId(req.body.application_id);
      if (appIdParsed.error) {
        return renderTodosPage(req, res, {
          status: 422,
          error: appIdParsed.error,
          values: { title, category, due_date, application_id: '' },
        });
      }
      nextAppId = appIdParsed.value;
    }

    const fieldError = validateTodoFields({ title, category, due_date });
    if (fieldError) {
      return renderTodosPage(req, res, {
        status: 422,
        error: fieldError,
        values: { title, category, due_date, application_id: nextAppId || '' },
      });
    }

    if (nextAppId && !getApplicationById(db, userId, nextAppId)) {
      return next(createHttpError(404, '연결할 지원 내역을 찾을 수 없습니다.'));
    }

    try {
      updateTodo(db, userId, id, {
        title,
        category,
        due_date: due_date || null,
        application_id: nextAppId,
      });
      req.setFlash('success', '할 일이 수정되었습니다.');
      return res.redirect(redirectTo);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:id/toggle', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(createHttpError(404, '요청한 할 일을 찾을 수 없습니다.'));

    const updated = toggleTodo(db, req.session.user.id, id);
    if (!updated) return next(createHttpError(404, '요청한 할 일을 찾을 수 없습니다.'));

    const redirectTo = safeRedirectPath(req.body.redirect_to, '/todos');
    return res.redirect(redirectTo);
  });

  router.delete('/:id', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(createHttpError(404, '요청한 할 일을 찾을 수 없습니다.'));

    const deleted = deleteTodo(db, req.session.user.id, id);
    if (!deleted) return next(createHttpError(404, '요청한 할 일을 찾을 수 없습니다.'));

    req.setFlash('success', '할 일이 삭제되었습니다.');
    const redirectTo = safeRedirectPath(req.body.redirect_to, '/todos');
    return res.redirect(redirectTo);
  });

  return router;
}

function createTodosApiRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.patch('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: '요청한 할 일을 찾을 수 없습니다.' });

    const parsedDone = parseBooleanDone(req.body ? req.body.is_done : undefined);
    if (parsedDone.error) {
      return res.status(422).json({ error: parsedDone.error });
    }

    const updated = setTodoDone(db, req.session.user.id, id, parsedDone.value);
    if (!updated) {
      return res.status(404).json({ error: '요청한 할 일을 찾을 수 없습니다.' });
    }

    return res.json({
      ok: true,
      id: updated.id,
      is_done: updated.is_done,
      done_at: updated.done_at,
      todo: updated,
    });
  });

  return router;
}

module.exports = {
  createTodosRouter,
  createTodosApiRouter,
};
