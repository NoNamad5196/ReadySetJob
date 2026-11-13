const express = require('express');
const { ensureCsrfToken } = require('../middleware/csrf');
const { REMEMBER_ME_MAX_AGE, sanitizeReturnTo } = require('../middleware/auth');
const { isValidEmail } = require('../middleware/validation');
const {
  findByEmail,
  createUser,
  verifyUserCredentials,
} = require('../services/usersService');

function isRememberMeChecked(body) {
  if (!body || typeof body !== 'object') return false;
  const raw =
    body.remember_me !== undefined
      ? body.remember_me
      : body.rememberMe !== undefined
        ? body.rememberMe
        : body.remember;
  if (raw === true || raw === 1) return true;
  if (typeof raw === 'string') {
    return ['1', 'on', 'true', 'yes'].includes(raw.trim().toLowerCase());
  }
  return false;
}


function createAuthRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    if (req.session && req.session.user) {
      return res.redirect('/dashboard');
    }
    return res.redirect('/login');
  });

  router.get('/signup', (req, res) => {
    if (req.session && req.session.user) {
      return res.redirect('/dashboard');
    }
    return res.render('auth/signup', {
      title: '회원가입',
      error: null,
      values: { email: '', name: '' },
    });
  });

  router.post('/signup', (req, res, next) => {
    const email = String(req.body.email || '').trim();
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');

    if (!name) {
      return res.status(422).render('auth/signup', {
        title: '회원가입',
        error: '이름을 입력해 주세요.',
        values: { email, name },
      });
    }

    if (!isValidEmail(email)) {
      return res.status(422).render('auth/signup', {
        title: '회원가입',
        error: '올바른 이메일 형식을 입력해 주세요.',
        values: { email, name },
      });
    }

    if (password.length < 8) {
      return res.status(422).render('auth/signup', {
        title: '회원가입',
        error: '비밀번호는 최소 8자 이상이어야 합니다.',
        values: { email, name },
      });
    }

    const existing = findByEmail(db, email);
    if (existing) {
      return res.status(422).render('auth/signup', {
        title: '회원가입',
        error: '이미 사용 중인 이메일입니다.',
        values: { email, name },
      });
    }

    let createdUser;
    try {
      createdUser = createUser(db, { email, password, name });
    } catch (err) {
      // Catch duplicate email race condition from SQLite UNIQUE constraint.
      // Trade-off: returning "이미 사용 중인 이메일입니다." permits user enumeration,
      // but for this personal job-tracking application, user-friendly feedback is preferred.
      if (
        err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        (err.message && err.message.includes('UNIQUE constraint failed'))
      ) {
        return res.status(422).render('auth/signup', {
          title: '회원가입',
          error: '이미 사용 중인 이메일입니다.',
          values: { email, name },
        });
      }
      return next(err);
    }

    return req.session.regenerate((regenErr) => {
      if (regenErr) {
        return next(regenErr);
      }
      req.session.user = {
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
      };
      ensureCsrfToken(req);
      req.session.flash = {
        type: 'success',
        message: '회원가입이 완료되었습니다. 환영합니다!',
      };
      return req.session.save((saveErr) => {
        if (saveErr) {
          return next(saveErr);
        }
        return res.redirect('/dashboard');
      });
    });
  });

  router.get('/login', (req, res) => {
    if (req.session && req.session.user) {
      return res.redirect('/dashboard');
    }
    const queryReturnTo = sanitizeReturnTo(req.query && req.query.returnTo);
    if (queryReturnTo && req.session) {
      req.session.returnTo = queryReturnTo;
    }
    const returnTo = queryReturnTo || sanitizeReturnTo(req.session && req.session.returnTo) || '';
    return res.render('auth/login', {
      title: '로그인',
      error: null,
      values: { email: '', remember_me: false, returnTo },
    });
  });

  router.post('/login', (req, res, next) => {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const rememberMe = isRememberMeChecked(req.body);
    const returnTo =
      sanitizeReturnTo(req.body && (req.body.returnTo || req.body.redirect_to)) ||
      sanitizeReturnTo(req.query && req.query.returnTo) ||
      sanitizeReturnTo(req.session && req.session.returnTo);
    const genericError = '이메일 또는 비밀번호가 올바르지 않습니다.';

    if (!isValidEmail(email) || !password) {
      return res.status(422).render('auth/login', {
        title: '로그인',
        error: genericError,
        values: { email, remember_me: rememberMe, returnTo: returnTo || '' },
      });
    }

    const verifiedUser = verifyUserCredentials(db, { email, password });
    if (!verifiedUser) {
      return res.status(401).render('auth/login', {
        title: '로그인',
        error: genericError,
        values: { email, remember_me: rememberMe, returnTo: returnTo || '' },
      });
    }

    return req.session.regenerate((regenErr) => {
      if (regenErr) {
        return next(regenErr);
      }
      req.session.user = verifiedUser;
      if (rememberMe) {
        req.session.rememberMe = true;
        req.session.cookie.maxAge = REMEMBER_ME_MAX_AGE;
      } else {
        req.session.rememberMe = false;
      }
      ensureCsrfToken(req);
      req.session.flash = {
        type: 'success',
        message: `${verifiedUser.name}님, 환영합니다.`,
      };
      return req.session.save((saveErr) => {
        if (saveErr) {
          return next(saveErr);
        }
        return res.redirect(returnTo || '/dashboard');
      });
    });
  });


  router.post('/logout', (req, res, next) => {
    return req.session.destroy((err) => {
      if (err) {
        return next(err);
      }
      res.clearCookie('readysetjob.sid', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
      return res.redirect('/login');
    });
  });

  return router;
}

module.exports = { createAuthRouter };
