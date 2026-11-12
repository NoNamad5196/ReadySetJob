const { STAGE_LABELS, TODO_CATEGORY_LABELS } = require('../middleware/validation');
const { getDashboardHome } = require('./dashboardHomeService');
const { getMonthlyGoalProgress, getCurrentYearMonth } = require('./usersService');
const { validateBriefingOutput } = require('./aiSchemas');

// Bound fields before serialization so the monthly goal and JSON structure survive.
function contextText(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function buildBriefingContext(db, userId, now = new Date()) {
  const uid = Number(userId);
  const today = toIsoDate(now);
  const weekEnd = toIsoDate(addDays(now, 7));
  const hrefs = new Set(['/dashboard', '/applications/board', '/jobs', '/essays', '/todos', '/events', '/interview-prep']);

  const deadlines = db.prepare(`
    SELECT jp.id, jp.title, jp.deadline, c.name AS company, a.id AS application_id, a.stage
    FROM job_posts jp
    INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
    LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
    WHERE jp.user_id = ? AND jp.deadline IS NOT NULL AND jp.deadline >= ? AND jp.deadline <= ?
      AND (a.id IS NULL OR a.result = 'in_progress')
    ORDER BY jp.deadline ASC, jp.id ASC LIMIT 10
  `).all(uid, today, weekEnd).map((r) => {
    const href = r.application_id ? `/applications/${r.application_id}` : `/jobs/${r.id}`;
    hrefs.add(href);
    return { type: '서류 마감', date: r.deadline, company: contextText(r.company, 120), title: contextText(r.title), applied: Boolean(r.application_id), href };
  });

  const events = db.prepare(`
    SELECT e.title, e.type, e.starts_at, a.id AS application_id, c.name AS company
    FROM events e
    LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
    LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
    LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
    WHERE e.user_id = ? AND substr(e.starts_at, 1, 10) >= ? AND substr(e.starts_at, 1, 10) <= ?
    ORDER BY e.starts_at ASC, e.id ASC LIMIT 10
  `).all(uid, today, weekEnd).map((r) => {
    const href = r.application_id ? `/applications/${r.application_id}` : '/events';
    hrefs.add(href);
    return { type: r.type, date: String(r.starts_at).slice(0, 10), time: String(r.starts_at).slice(11, 16), company: contextText(r.company, 120), title: contextText(r.title), href };
  });

  const openTodos = db.prepare(`
    SELECT title, category, due_date FROM todos
    WHERE user_id = ? AND is_done = 0
    ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC, due_date ASC, id ASC LIMIT 10
  `).all(uid).map((t) => ({ title: contextText(t.title, 120), category: TODO_CATEGORY_LABELS[t.category] || '기타', due_date: t.due_date || null, href: '/todos' }));

  const home = getDashboardHome(db, uid, now);
  const stageCounts = {};
  for (const application of home.inProgress) {
    const label = STAGE_LABELS[application.stage] || application.stage;
    stageCounts[label] = (stageCounts[label] || 0) + 1;
  }
  const inProgress = home.inProgress.slice(0, 10).map((a) => {
    const label = STAGE_LABELS[a.stage] || a.stage;
    hrefs.add(a.href);
    return { company: contextText(a.company, 120), position: contextText(a.position), stage: label, next: contextText(a.nextLabel), href: a.href };
  });

  const goal = getMonthlyGoalProgress(db, uid, getCurrentYearMonth(now));

  return {
    context: {
      today,
      period: `${today} ~ ${weekEnd}`,
      deadlines_next_7_days: deadlines,
      events_next_7_days: events,
      open_todos: openTodos,
      in_progress_applications: { total: home.inProgress.length, by_stage: stageCounts, items: inProgress },
      monthly_goal: { month: goal.month, target: goal.target, current: goal.current },
    },
    allowedHrefs: Array.from(hrefs),
  };
}

function parseRow(row) {
  if (!row) return null;
  let result = null;
  try {
    result = validateBriefingOutput(JSON.parse(row.result_json), (message) => new Error(message));
  } catch {
    return null;
  }
  return { id: row.id, briefing_date: row.briefing_date, model: row.model, created_at: row.created_at, result };
}

function getBriefingForDate(db, userId, dateStr) {
  const row = db
    .prepare('SELECT id, briefing_date, model, result_json, created_at FROM ai_briefings WHERE user_id = ? AND briefing_date = ?')
    .get(Number(userId), dateStr);
  return parseRow(row);
}

function saveBriefing(db, userId, { dateStr, model, result }) {
  db.prepare(`
    INSERT INTO ai_briefings (user_id, briefing_date, model, result_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, briefing_date) DO UPDATE SET
      model = excluded.model, result_json = excluded.result_json, created_at = datetime('now')
  `).run(Number(userId), dateStr, String(model), JSON.stringify(result));
  return getBriefingForDate(db, userId, dateStr);
}

module.exports = {
  toIsoDate,
  buildBriefingContext,
  getBriefingForDate,
  saveBriefing,
};
