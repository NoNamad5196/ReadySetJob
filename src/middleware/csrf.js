const crypto = require('node:crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function tokensMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') {
    return false;
  }
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function csrfProtection(req, res, next) {
  const token = ensureCsrfToken(req);
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const submitted =
    (req.body && typeof req.body._csrf === 'string' && req.body._csrf) ||
    req.get('X-CSRF-Token') ||
    req.get('x-csrf-token') ||
    '';

  if (!tokensMatch(token, submitted)) {
    if (req.originalUrl.startsWith('/api')) {
      return res.status(403).json({ error: '유효하지 않은 CSRF 토큰입니다.' });
    }
    return res.status(403).render('error', {
      title: '보안 토큰 오류 (403)',
      status: 403,
      message: '유효하지 않은 CSRF 토큰입니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    });
  }

  return next();
}

module.exports = {
  csrfProtection,
  ensureCsrfToken,
};
