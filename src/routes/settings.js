const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  findById,
  getCurrentYearMonth,
  getMonthlyGoalProgress,
  updateUserSettings,
} = require('../services/usersService');
const { isAiEnabled, getAiConfig } = require('../services/aiService');

const POSITIVE_INT_STR = /^\s*\d+\s*$/;

function parseGoalTargetInput(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { value: null };
  }
  if (typeof raw === 'boolean') {
    return { error: '이번 달 지원 목표는 1 이상 200 이하의 정수로 입력해 주세요.' };
  }
  if (typeof raw === 'string' && !POSITIVE_INT_STR.test(raw)) {
    return { error: '이번 달 지원 목표는 1 이상 200 이하의 정수로 입력해 주세요.' };
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 200) {
    return { error: '이번 달 지원 목표는 1 이상 200 이하의 정수로 입력해 주세요.' };
  }
  return { value: num };
}

function createSettingsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const userId = req.session.user.id;
    const user = findById(db, userId) || req.session.user;
    const goal = getMonthlyGoalProgress(db, userId);

    return res.render('settings/index', {
      title: '설정',
      user,
      goal,
      aiEnabled: isAiEnabled(),
      aiConfig: getAiConfig(),
      error: null,
      values: {
        name: user.name || '',
        season_label: user.season_label || '',
        target: goal.target !== null ? String(goal.target) : '',
      },
    });
  });

  router.get('/ai', (req, res) => {
    const userId = req.session.user.id;
    const user = findById(db, userId) || req.session.user;
    return res.render('settings/ai', {
      title: 'AI 연동 설정',
      user,
      aiEnabled: isAiEnabled(),
      aiConfig: getAiConfig(),
    });
  });

  router.post('/', (req, res, next) => {
    const userId = req.session.user.id;
    const user = findById(db, userId) || req.session.user;
    const currentGoal = getMonthlyGoalProgress(db, userId);

    const name = req.body.name !== undefined ? String(req.body.name).trim() : (user.name || '');
    const season_label = req.body.season_label !== undefined
      ? String(req.body.season_label).trim()
      : (user.season_label || '');
    const rawTarget =
      req.body.target !== undefined
        ? req.body.target
        : req.body.monthly_goal !== undefined
          ? req.body.monthly_goal
          : req.body.goal_target;

    const renderInvalid = (errorMessage) =>
      res.status(422).render('settings/index', {
        title: '설정',
        user,
        goal: currentGoal,
        aiEnabled: isAiEnabled(),
        aiConfig: getAiConfig(),
        error: errorMessage,
        values: {
          name,
          season_label,
          target: rawTarget !== undefined && rawTarget !== null ? String(rawTarget).trim() : '',
        },
      });

    if (!name || name.length > 60) {
      return renderInvalid('이름을 1자 이상 60자 이하로 입력해 주세요.');
    }
    if (season_label.length > 80) {
      return renderInvalid('시즌 라벨은 80자 이하로 입력해 주세요.');
    }

    const parsedTarget = parseGoalTargetInput(rawTarget);
    if (parsedTarget.error) {
      return renderInvalid(parsedTarget.error);
    }

    try {
      const month = req.body.month && /^\d{4}-\d{2}$/.test(String(req.body.month).trim())
        ? String(req.body.month).trim()
        : getCurrentYearMonth();
      const updated = updateUserSettings(db, userId, {
        name,
        season_label,
        target: parsedTarget.value,
        month,
      });

      if (updated && updated.user && req.session && req.session.user) {
        req.session.user.name = updated.user.name;
        req.session.user.season_label = updated.user.season_label || null;
      }

      req.setFlash('success', '설정이 저장되었습니다.');
      return res.redirect('/settings');
    } catch (err) {
      if (err.status === 422) {
        return renderInvalid(err.message);
      }
      return next(err);
    }
  });

  router.get('/ai', (req, res) => {
    const aiConfig = getAiConfig();
    return res.render('settings/ai', {
      title: 'AI 설정',
      aiEnabled: aiConfig.enabled,
      aiConfig,
      envFilePath: '/home/box/projects/ReadySetJob/.env',
    });
  });

  return router;
}

module.exports = { createSettingsRouter };
