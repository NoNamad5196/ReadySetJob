const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { EVENT_TYPES, isValidDateTime } = require('../middleware/validation');
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
    const application_id = req.body.application_id ? Number(req.body.application_id) : null;
    const title = String(req.body.title || '').trim();
    const type = String(req.body.type || 'other').trim();
    const starts_at = String(req.body.starts_at || '').trim();
    const memo = String(req.body.memo || '').trim();
    const redirectTo = req.body.redirect_to || '/events';

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

    createEvent(db, userId, {
      application_id,
      title,
      type,
      starts_at,
      memo,
    });

    req.setFlash('success', '일정이 등록되었습니다.');
    return res.redirect(redirectTo);
  });

  router.delete('/:id', (req, res, next) => {
    const deleted = deleteEvent(db, req.session.user.id, req.params.id);
    if (!deleted) {
      return next(createHttpError(404, '요청한 일정을 찾을 수 없습니다.'));
    }
    req.setFlash('success', '일정이 삭제되었습니다.');
    const redirectTo = req.body.redirect_to || '/events';
    return res.redirect(redirectTo);
  });

  return router;
}

module.exports = { createEventsRouter };
