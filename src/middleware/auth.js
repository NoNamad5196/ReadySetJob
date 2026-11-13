const { safeRedirectPath } = require('./validation');

const REMEMBER_ME_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

function sanitizeReturnTo(value) {
  if (typeof value !== 'string') return null;
  const candidate = safeRedirectPath(value, '');
  if (
    !candidate ||
    candidate === '/' ||
    candidate.startsWith('/login') ||
    candidate.startsWith('/signup') ||
    candidate.startsWith('/logout') ||
    candidate.startsWith('/api')
  ) {
    return null;
  }
  return candidate;
}

function attachSessionLocals(req, res, next) {
  if (req.session && req.session.user && req.session.rememberMe && req.session.cookie) {
    const prevTime =
      req.session.cookie.expires instanceof Date
        ? req.session.cookie.expires.getTime()
        : 0;
    const nextTime = Math.max(Date.now() + REMEMBER_ME_MAX_AGE, prevTime + 1);
    req.session.cookie.expires = new Date(nextTime);
    req.session.cookie.originalMaxAge = REMEMBER_ME_MAX_AGE;
  }

  res.locals.currentUser = (req.session && req.session.user) || null;
  res.locals.currentPath = (req.originalUrl ? req.originalUrl.split('?')[0] : req.path) || '/';

  const flash = req.session ? req.session.flash : null;
  if (req.session && req.session.flash) {
    delete req.session.flash;
  }
  res.locals.flash = flash || null;

  req.setFlash = function setFlash(type, message) {
    if (req.session) {
      req.session.flash = { type, message };
    }
  };

  next();
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.originalUrl.startsWith('/api')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  if (req.session && (req.method === 'GET' || req.method === 'HEAD')) {
    const returnTo = sanitizeReturnTo(req.originalUrl);
    if (returnTo) {
      req.session.returnTo = returnTo;
    }
  }
  return res.redirect('/login');
}

module.exports = {
  REMEMBER_ME_MAX_AGE,
  sanitizeReturnTo,
  attachSessionLocals,
  requireAuth,
};

