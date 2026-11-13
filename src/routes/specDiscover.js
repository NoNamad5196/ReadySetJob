const crypto = require('node:crypto');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const options = require('../services/specSources/discoverOptions');
const sources = require('../services/specSources');
const qnetCatalog = require('../services/specSources/qnetCatalog');

const MAX_STORED_RESULTS = 60;
const TOKEN_RE = /^[a-f0-9]{24}$/;
const REGISTER_FIELDS = ['kind', 'title', 'organizer', 'source', 'source_ref', 'source_url', 'apply_start', 'apply_end', 'event_date', 'end_date', 'result_date', 'memo'];

function loadSpecsService(override) { return override || require('../services/specsService'); }

function viewOptions() {
  const year = options.currentYear();
  return { ...options, YEARS: [String(year), String(year + 1)] };
}

// Results are kept server-side so registration can only use data an adapter actually returned and verified.
function storeResults(req, items) {
  const stored = {};
  const decorated = items.slice(0, MAX_STORED_RESULTS).map((item) => {
    const token = crypto.randomBytes(12).toString('hex');
    stored[token] = item;
    return sources.decorateItem(item, token);
  });
  req.session.specDiscover = stored;
  return decorated;
}

function createHandlers(db, deps) {
  const runDiscover = deps.runDiscover || sources.runDiscover;
  const searchCatalog = deps.searchCatalog || ((query) => qnetCatalog.search({ keyword: query }, { db }));

  async function catalogFor(form) {
    try { return await searchCatalog(form.cert_query || ''); } catch { return []; }
  }

  async function search(req) {
    const parsed = options.validateDiscoverInput(req.body);
    const form = { ...parsed.form, cert_query: typeof req.body.cert_query === 'string' ? req.body.cert_query.trim().slice(0, 40) : '' };
    if (!parsed.ok) return { status: 422, error: parsed.error, form };
    if (form.mode === 'catalog') return { status: 200, form, results: null };
    try {
      const outcome = await runDiscover(form, { db, userId: req.session.user.id });
      return { status: 200, form, results: storeResults(req, outcome.items), notices: outcome.notices, dropped: outcome.dropped };
    } catch (error) {
      const status = [422, 429, 504].includes(error.status) ? error.status : 502;
      return { status, form, error: error.expose ? error.message : '스펙 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
    }
  }

  async function render(res, status, locals = {}) {
    const form = locals.form || { ...options.defaultDiscoverForm(), cert_query: '' };
    return res.status(status).render('specs/discover', {
      title: '스펙 찾기', opts: viewOptions(), form, results: null, notices: [], dropped: 0, error: null,
      statuses: sources.sourceStatuses(), catalog: await catalogFor(form), ...locals,
    });
  }

  return { search, render, catalogFor, searchCatalog };
}

function createSpecDiscoverApiRouter(db, deps = {}) {
  const router = express.Router();
  const handlers = createHandlers(db, deps);
  router.post('/discover', requireAuth, csrfProtection, async (req, res) => {
    const outcome = await handlers.search(req);
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    return res.json({ ok: true, items: outcome.results || [], notices: outcome.notices || [], dropped: outcome.dropped || 0 });
  });
  return router;
}

function createSpecDiscoverRouter(db, deps = {}) {
  const app = express();
  const router = express.Router();
  const handlers = createHandlers(db, deps);
  const apiRouter = createSpecDiscoverApiRouter(db, deps);
  app.on('mount', (parent) => {
    app.set('views', parent.get('views'));
    app.set('view engine', parent.get('view engine'));
    Object.setPrototypeOf(app.locals, parent.locals);
    parent.use('/api/specs', apiRouter);
  });

  router.use(requireAuth, csrfProtection);
  router.get('/discover', (req, res) => handlers.render(res, 200));

  router.get('/discover/catalog', requireAuth, async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
    const items = (await handlers.catalogFor({ cert_query: query })).map(({ jmCd, name, field }) => ({ jmCd, name, field }));
    return res.json({ ok: true, items });
  });

  router.post('/discover', requireAuth, async (req, res) => {
    const outcome = await handlers.search(req);
    return handlers.render(res, outcome.status, outcome);
  });

  router.post('/discover/register', requireAuth, (req, res) => {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const item = TOKEN_RE.test(token) && req.session.specDiscover ? req.session.specDiscover[token] : null;
    if (!item || item.category === 'job') {
      return handlers.render(res, 422, { error: '등록할 검색 결과를 찾을 수 없습니다. 다시 검색해 주세요.' });
    }
    const payload = Object.fromEntries(REGISTER_FIELDS.map((key) => [key, item[key] == null ? null : item[key]]));
    let created;
    try {
      created = loadSpecsService(deps.specsService).createSpecItem(db, req.session.user.id, payload);
    } catch (error) {
      if (error.status === 422) return handlers.render(res, 422, { error: error.message });
      throw error;
    }
    req.setFlash('success', created.duplicate
      ? '이미 등록된 스펙입니다. 기존 항목으로 이동했습니다.'
      : '스펙에 등록했습니다. 일정과 할 일이 자동으로 추가되었습니다.');
    return res.redirect(`/specs/${created.id}`);
  });

  router.post('/discover/watch', requireAuth, async (req, res) => {
    const code = typeof req.body.cert_code === 'string' ? req.body.cert_code.trim() : '';
    const cert = /^\d{1,8}$/.test(code) ? await qnetCatalog.resolveCert({ cert_code: code }, { db }).catch(() => null) : null;
    if (!cert) return handlers.render(res, 422, { error: '구독할 자격증을 카탈로그에서 선택해 주세요.' });
    const result = loadSpecsService(deps.specsService).addWatch(db, req.session.user.id, { cert_code: cert.jmCd, cert_name: cert.name });
    req.setFlash('success', result.duplicate
      ? `이미 ${cert.name}을(를) 구독하고 있습니다.`
      : `${cert.name}을(를) 관심 자격증으로 구독했습니다. 다음 회차 일정이 자동으로 추가됩니다.`);
    return res.redirect('/specs/discover');
  });

  app.use(router);
  return app;
}

module.exports = { createSpecDiscoverRouter, createSpecDiscoverApiRouter };
