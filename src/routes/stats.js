const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getDashboardStats,
  serializeDashboardData,
} = require('../services/dashboardService');
const { computeConversionStats } = require('../services/statsService');

function createStatsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const userId = req.session.user.id;
    const dashboardStats = getDashboardStats(db, userId);
    const conversion = computeConversionStats(db, userId);
    const stats = {
      ...dashboardStats,
      ...conversion,
    };
    const statsDataJson = serializeDashboardData(stats);

    return res.render('stats/index', {
      title: '통계 및 분석',
      stats,
      statsDataJson,
    });
  });

  return router;
}

module.exports = { createStatsRouter };
