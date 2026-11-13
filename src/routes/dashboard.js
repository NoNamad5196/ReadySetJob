const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getDashboardStats,
  getDashboardHome,
  serializeDashboardData,
} = require('../services/dashboardService');
const { toIsoDate, getBriefingForDate } = require('../services/aiBriefingService');
const { listUpcomingSpecDates } = require('../services/specsService');

function createDashboardRouter(db) {
  const router = express.Router();

  router.get('/dashboard', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const stats = getDashboardStats(db, userId);
    const home = getDashboardHome(db, userId);
    const dashboardDataJson = serializeDashboardData(stats);
    const aiBriefing = getBriefingForDate(db, userId, toIsoDate(new Date()));
    return res.render('dashboard/index', {
      aiBriefing,
      specUpcoming: listUpcomingSpecDates(db, userId, { days: 14, limit: 5 }),
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
