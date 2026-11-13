const { calculateDday } = require('./validation');
const {
  findById,
  getCurrentYearMonth,
  getMonthlyGoalProgress,
} = require('../services/usersService');

function getShellData(db, userId, now = new Date()) {
  const uid = Number(userId);
  const userRow = findById(db, uid);
  const user = userRow
    ? {
        id: userRow.id,
        name: userRow.name,
        email: userRow.email,
        season_label: userRow.season_label || null,
        avatar_data: userRow.avatar_data || null,
      }
    : { id: uid, name: '', email: '', season_label: null, avatar_data: null };


  const inProgressRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM applications WHERE user_id = ? AND result = 'in_progress'")
    .get(uid);
  const todosOpenRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM todos WHERE user_id = ? AND is_done = 0')
    .get(uid);

  const counts = {
    applications_in_progress: inProgressRow ? Number(inProgressRow.cnt) || 0 : 0,
    todos_open: todosOpenRow ? Number(todosOpenRow.cnt) || 0 : 0,
  };

  const favorites = db
    .prepare(`
      SELECT
        a.id,
        c.name AS company_name,
        COALESCE(NULLIF(jp.position, ''), jp.title) AS position,
        jp.title AS job_title,
        a.stage
      FROM applications a
      INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
      INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
      WHERE a.user_id = ? AND a.is_favorite = 1
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 5
    `)
    .all(uid)
    .map((r) => ({
      id: r.id,
      company_name: r.company_name,
      position: r.position,
      job_title: r.job_title,
      stage: r.stage,
    }));

  const goal = getMonthlyGoalProgress(db, uid, getCurrentYearMonth(now));

  const deadlineItems = db
    .prepare(`
      SELECT
        jp.id AS job_id,
        jp.title,
        jp.deadline AS date,
        c.name AS company_name,
        a.id AS application_id
      FROM job_posts jp
      INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
      LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
      WHERE jp.user_id = ?
        AND jp.deadline IS NOT NULL
        AND date(jp.deadline) >= date('now')
        AND date(jp.deadline) <= date('now', '+7 days')
        AND (a.id IS NULL OR a.result = 'in_progress')
      ORDER BY jp.deadline ASC, jp.id ASC
      LIMIT 8
    `)
    .all(uid)
    .map((r) => {
      const ddayObj = calculateDday(r.date);
      return {
        type: 'deadline',
        title: `${r.company_name} — ${r.title}`,
        company_name: r.company_name,
        date: r.date,
        dday: ddayObj.label,
        ddayObj,
        href: r.application_id ? `/applications/${r.application_id}` : `/jobs/${r.job_id}`,
      };
    });

  const eventItems = db
    .prepare(`
      SELECT
        e.id AS event_id,
        e.title,
        e.starts_at,
        e.application_id,
        c.name AS company_name
      FROM events e
      LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
      LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
      LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
      WHERE e.user_id = ?
        AND date(e.starts_at) >= date('now')
        AND date(e.starts_at) <= date('now', '+7 days')
      ORDER BY e.starts_at ASC, e.id ASC
      LIMIT 8
    `)
    .all(uid)
    .map((r) => {
      const dateStr = r.starts_at ? String(r.starts_at).slice(0, 10) : '';
      const ddayObj = calculateDday(dateStr);
      return {
        type: 'event',
        title: r.title,
        company_name: r.company_name || null,
        date: dateStr,
        dday: ddayObj.label,
        ddayObj,
        href: r.application_id ? `/applications/${r.application_id}` : '/events',
      };
    });

  const notifications = [...deadlineItems, ...eventItems]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 8);

  return {
    user,
    counts,
    favorites,
    goal,
    notifications,
  };
}

function attachShellData(db) {
  return function shellDataMiddleware(req, res, next) {
    if (!req.session || !req.session.user || !req.session.user.id) {
      return next();
    }
    if (req.originalUrl && req.originalUrl.startsWith('/api')) {
      return next();
    }
    res.locals.shell = getShellData(db, req.session.user.id);
    if (res.locals.currentUser && res.locals.shell && res.locals.shell.user) {
      res.locals.currentUser.avatar_data = res.locals.shell.user.avatar_data || null;
    }
    return next();

  };
}

module.exports = {
  getShellData,
  attachShellData,
};
