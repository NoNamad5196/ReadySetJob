const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getInterviewPrepData } = require('../services/interviewPrepService');
const { isAiEnabled } = require('../services/aiService');

function createInterviewPrepRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const data = getInterviewPrepData(db, req.session.user.id);
    return res.render('interview-prep/index', {
      title: '면접 준비',
      upcomingInterviews: data.upcomingInterviews,
      unscheduledApplications: data.unscheduledApplications,
      aiEnabled: isAiEnabled(),
    });
  });

  return router;
}

module.exports = { createInterviewPrepRouter };
