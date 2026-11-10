const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getDashboardStats,
  serializeDashboardData,
} = require('../services/dashboardService');

function createDashboardRouter(db) {
  const router = express.Router();

  router.get('/dashboard', requireAuth, (req, res) => {
    const stats = getDashboardStats(db, req.session.user.id);
    const dashboardDataJson = serializeDashboardData(stats);
    return res.render('dashboard/index', {
      title: '대시보드',
      stats,
      counts: stats.totals,
      dashboardDataJson,
    });
  });

  router.get('/api/dashboard/stats', requireAuth, (req, res) => {
    const stats = getDashboardStats(db, req.session.user.id);
    return res.json(stats);
  });

  return router;
}

module.exports = { createDashboardRouter };
