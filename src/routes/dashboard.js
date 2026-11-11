const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getDashboardStats,
  getDashboardHome,
  serializeDashboardData,
} = require('../services/dashboardService');

function createDashboardRouter(db) {
  const router = express.Router();

  router.get('/dashboard', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const stats = getDashboardStats(db, userId);
    const home = getDashboardHome(db, userId);
    const dashboardDataJson = serializeDashboardData(stats);
    return res.render('dashboard/index', {
      title: '대시보드',
      stats,
      counts: stats.totals,
      home,
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
