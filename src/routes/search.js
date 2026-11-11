const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { searchAll } = require('../services/searchService');

function createSearchRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const results = searchAll(db, req.session.user.id, q, { limit: 20 });
    return res.render('search/index', {
      title: q ? `"${q}" 검색 결과` : '통합 검색',
      q,
      results,
    });
  });

  router.get('/api/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const results = searchAll(db, req.session.user.id, q, { limit: 5 });
    return res.json(results);
  });

  return router;
}

module.exports = { createSearchRouter };
