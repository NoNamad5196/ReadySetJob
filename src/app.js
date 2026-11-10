const path = require('node:path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const createSqliteStore = require('better-sqlite3-session-store');
const helmet = require('helmet');
const methodOverride = require('method-override');
const morgan = require('morgan');

const { openDatabase } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { attachSessionLocals } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { attachUiHelpers } = require('./middleware/validation');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const { createAuthRouter } = require('./routes/auth');
const { createDashboardRouter } = require('./routes/dashboard');
const { createCompaniesRouter } = require('./routes/companies');
const { createJobsRouter } = require('./routes/jobs');
const { createApplicationsRouter, createApplicationsApiRouter } = require('./routes/applications');
const { createEventsRouter } = require('./routes/events');
const { createEssaysRouter, createEssaysApiRouter } = require('./routes/essays');

const BaseSqliteStore = createSqliteStore(session);

class SqliteSessionStore extends BaseSqliteStore {
  startInterval() {
    const timer = setInterval(
      this.clearExpiredSessions.bind(this),
      this.expired.intervalMs
    );
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }
}

function createApp({ dbPath } = {}) {
  const db = openDatabase(dbPath);
  migrate(db);

  const app = express();
  app.locals.db = db;
  app.db = db;

  app.set('views', path.join(__dirname, '../views'));
  app.set('view engine', 'ejs');
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
    })
  );

  if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
  }

  app.use(express.static(path.join(__dirname, '../public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use(methodOverride('_method'));
  app.use(
    methodOverride((req) => {
      if (req.body && typeof req.body === 'object' && '_method' in req.body) {
        const method = req.body._method;
        delete req.body._method;
        return method;
      }
      return undefined;
    })
  );

  let sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[ReadySetJob] Warning: SESSION_SECRET is not set. Using development fallback secret.'
      );
    }
    sessionSecret = 'readysetjob-dev-fallback-secret-key';
  }

  app.use(
    session({
      name: 'readysetjob.sid',
      store: new SqliteSessionStore({
        client: db,
        expired: {
          clear: true,
          intervalMs: 900000,
        },
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    })
  );

  app.use(attachSessionLocals);
  app.use(attachUiHelpers);
  app.use(csrfProtection);

  app.use('/', createAuthRouter(db));
  app.use('/', createDashboardRouter(db));
  app.use('/companies', createCompaniesRouter(db));
  app.use('/jobs', createJobsRouter(db));
  app.use('/applications', createApplicationsRouter(db));
  app.use('/api/applications', createApplicationsApiRouter(db));
  app.use('/events', createEventsRouter(db));
  app.use('/essays', createEssaysRouter(db));
  app.use('/api/essays', createEssaysApiRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
module.exports.createApp = createApp;
