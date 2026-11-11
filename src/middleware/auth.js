function attachSessionLocals(req, res, next) {
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
  return res.redirect('/login');
}

module.exports = {
  attachSessionLocals,
  requireAuth,
};
