function createHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

function notFoundHandler(req, res) {
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
  }
  return res.status(404).render('error', {
    title: '페이지를 찾을 수 없습니다 (404)',
    status: 404,
    message: '요청하신 페이지 또는 리소스를 찾을 수 없습니다.',
  });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const message =
    err.expose && err.message
      ? err.message
      : status === 404
        ? '요청하신 리소스를 찾을 수 없습니다.'
        : '서버 처리 중 오류가 발생했습니다.';

  if (req.originalUrl.startsWith('/api')) {
    return res.status(status).json({ error: message });
  }

  if (res.locals.currentUser === undefined) res.locals.currentUser = null;
  if (res.locals.csrfToken === undefined) res.locals.csrfToken = '';
  if (res.locals.flash === undefined) res.locals.flash = null;

  return res.status(status).render('error', {

    title: status === 404 ? '페이지를 찾을 수 없습니다 (404)' : `오류 (${status})`,
    status,
    message,
  });
}

module.exports = {
  createHttpError,
  notFoundHandler,
  errorHandler,
};
