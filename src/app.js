const fs = require('node:fs');
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
const { attachShellData } = require('./middleware/shellData');
const { csrfProtection } = require('./middleware/csrf');
const { attachUiHelpers } = require('./middleware/validation');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { companyAvatar } = require('./utils/avatar');

const { createAuthRouter } = require('./routes/auth');
const { createDashboardRouter } = require('./routes/dashboard');
const { createCompaniesRouter } = require('./routes/companies');
const { createJobsRouter } = require('./routes/jobs');
const { createApplicationsRouter, createApplicationsApiRouter } = require('./routes/applications');
const { createEventsRouter } = require('./routes/events');
const { createEssaysRouter, createEssaysApiRouter } = require('./routes/essays');
const { createMaterialsRouter } = require('./routes/materials');
const { createLibraryRouter, createLibraryApiRouter } = require('./routes/library');
const { multipartUploadMiddleware } = require('./services/libraryImportService');
const { createTodosRouter, createTodosApiRouter } = require('./routes/todos');
const { createSettingsRouter } = require('./routes/settings');
const { createStatsRouter } = require('./routes/stats');
const { createInterviewPrepRouter } = require('./routes/interviewPrep');
const { createSearchRouter } = require('./routes/search');
const { createAiRouter, createJobDiscoverRouter } = require('./routes/ai');
const { createLogosRouter } = require('./routes/logos');
const { createSpecsRouter, createSpecsApiRouter } = require('./routes/specs');

const SPEC_DISCOVER_ROUTE = path.join(__dirname, 'routes', 'specDiscover.js');

// /specs/discover is owned by an optional module; it must mount before
// createSpecsRouter so the literal path is not captured by /specs/:id.
function mountSpecDiscover(app, db) {
  if (!fs.existsSync(SPEC_DISCOVER_ROUTE)) return;
  const { createSpecDiscoverRouter } = require(SPEC_DISCOVER_ROUTE);
  if (typeof createSpecDiscoverRouter === 'function') {
    app.use('/specs', createSpecDiscoverRouter(db));
    app.locals.specDiscoverEnabled = true;
  }
}
const { isAiEnabled } = require('./services/aiService');

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
  app.locals.companyAvatar = companyAvatar;
  app.db = db;

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

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
  app.use(
    '/vendor/chart.js',
    express.static(path.join(__dirname, '../node_modules/chart.js/dist'))
  );
  app.use(
    '/vendor/pretendard',
    express.static(path.join(__dirname, '../node_modules/pretendard/dist/web/variable'))
  );
  app.use(
    '/settings/avatar',
    express.urlencoded({ extended: false, limit: '350kb' }),
    express.json({ limit: '350kb' })
  );
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/library/import', multipartUploadMiddleware);
  app.use('/api/library/import', multipartUploadMiddleware);


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
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET environment variable is required in production mode.'
      );
    }
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
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    })
  );

  app.use(attachSessionLocals);
  app.use(attachUiHelpers);
  app.use(attachShellData(db));
  app.use(csrfProtection);
  app.use((req, res, next) => {
    res.locals.aiEnabled = isAiEnabled();
    next();
  });

  app.use('/', createAuthRouter(db));
  app.use('/', createDashboardRouter(db));
  app.use('/', createSearchRouter(db));
  app.use('/logos', createLogosRouter(db));
  app.use('/companies', createCompaniesRouter(db));
  app.use('/', createJobDiscoverRouter());
  app.use('/jobs', createJobsRouter(db));
  mountSpecDiscover(app, db);
  app.use('/specs', createSpecsRouter(db));
  app.use('/api/specs', createSpecsApiRouter(db));
  app.use('/applications', createApplicationsRouter(db));
  app.use('/api/applications', createApplicationsApiRouter(db));
  app.use('/events', createEventsRouter(db));
  app.use('/essays', createEssaysRouter(db));
  app.use('/api/essays', createEssaysApiRouter(db));
  app.use('/library', createLibraryRouter(db));
  app.use('/api/library', createLibraryApiRouter(db));
  app.use('/materials', createMaterialsRouter(db));
  app.use('/todos', createTodosRouter(db));
  app.use('/api/todos', createTodosApiRouter(db));
  app.use('/settings', createSettingsRouter(db));
  app.use('/stats', createStatsRouter(db));
  app.use('/interview-prep', createInterviewPrepRouter(db));
  app.use('/', createAiRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
module.exports.createApp = createApp;
