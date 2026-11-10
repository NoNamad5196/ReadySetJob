const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  EVENT_TYPES,
  isValidDateTime,
  safeRedirectPath,
  parseId,
} = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const { listApplications, getApplicationById } = require('../services/applicationsService');
const {
  listEvents,
  createEvent,
  deleteEvent,
} = require('../services/eventsService');

function createEventsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const userId = req.session.user.id;
    const events = listEvents(db, userId);
    const applications = listApplications(db, userId);
    return res.render('events/index', {
      title: '일정 관리',
      events,
      applications,
      error: null,
      values: {
        application_id: req.query.application_id || '',
        title: '',
        type: 'interview',
        starts_at: '',
        memo: '',
      },
    });
  });

  router.post('/', (req, res, next) => {
    const userId = req.session.user.id;
    let application_id = null;
    const rawAppId = req.body.application_id;
    if (rawAppId !== undefined && rawAppId !== null && String(rawAppId).trim() !== '') {
      application_id = parseId(rawAppId);
      if (!application_id) {
        const events = listEvents(db, userId);
        const applications = listApplications(db, userId);
        return res.status(422).render('events/index', {
          title: '일정 관리',
          events,
          applications,
          error: '올바른 지원 내역을 선택해 주세요.',
          values: {
            application_id: '',
            title: String(req.body.title || '').trim(),
            type: String(req.body.type || 'other').trim(),
            starts_at: String(req.body.starts_at || '').trim(),
            memo: String(req.body.memo || '').trim(),
          },
        });
      }
    }
    const title = String(req.body.title || '').trim();
    const type = String(req.body.type || 'other').trim();
    const starts_at = String(req.body.starts_at || '').trim();
    const memo = String(req.body.memo || '').trim();
    const redirectTo = safeRedirectPath(req.body.redirect_to, '/events');

    const renderInvalid = (errorMessage) => {
      const events = listEvents(db, userId);
      const applications = listApplications(db, userId);
      return res.status(422).render('events/index', {
        title: '일정 관리',
        events,
        applications,
        error: errorMessage,
        values: {
          application_id: application_id || '',
          title,
          type,
          starts_at,
          memo,
        },
      });
    };

    if (!title) {
      return renderInvalid('일정 제목을 입력해 주세요.');
    }

    if (!EVENT_TYPES.includes(type)) {
      return renderInvalid('올바른 일정 유형을 선택해 주세요.');
    }

    if (!isValidDateTime(starts_at)) {
      return renderInvalid('일정 일시를 올바르게 입력해 주세요.');
    }

    if (application_id) {
      const ownedApp = getApplicationById(db, userId, application_id);
      if (!ownedApp) {
        return next(createHttpError(404, '연결할 지원 내역을 찾을 수 없습니다.'));
      }
    }

    try {
      createEvent(db, userId, {
        application_id,
        title,
        type,
        starts_at,
        memo,
      });
    } catch (err) {
      return next(err);
    }

    req.setFlash('success', '일정이 등록되었습니다.');
    return res.redirect(redirectTo);
  });

  router.delete('/:id', (req, res, next) => {
    const eventId = parseId(req.params.id);
    if (!eventId) {
      return next(createHttpError(404, '요청한 일정을 찾을 수 없습니다.'));
    }
    const deleted = deleteEvent(db, req.session.user.id, eventId);
    if (!deleted) {
      return next(createHttpError(404, '요청한 일정을 찾을 수 없습니다.'));
    }
    req.setFlash('success', '일정이 삭제되었습니다.');
    const redirectTo = safeRedirectPath(req.body.redirect_to, '/events');
    return res.redirect(redirectTo);
  });

  return router;
}

module.exports = { createEventsRouter };
