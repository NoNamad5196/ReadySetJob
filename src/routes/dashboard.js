const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDashboardCounts } = require('../services/usersService');

function createDashboardRouter(db) {
  const router = express.Router();

  router.get('/dashboard', requireAuth, (req, res) => {
    const counts = getDashboardCounts(db, req.session.user.id);
    return res.render('dashboard/index', {
      title: '대시보드',
      counts,
    });
  });

  return router;
}

module.exports = { createDashboardRouter };
