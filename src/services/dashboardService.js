const {
  APPLICATION_STAGES,
  STAGE_LABELS,
  RESULT_LABELS,
  EVENT_TYPE_LABELS,
  calculateDday,
} = require('../middleware/validation');
const { computeConversionStats } = require('./statsService');
const { getDashboardHome } = require('./dashboardHomeService');

function getLast6Months(now = new Date()) {
  const months = [];
  const y = now.getFullYear();
  const m = now.getMonth();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(y, m - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    months.push({ key: `${year}-${month}`, label: `${year}.${month}` });
  }
  return months;
}

function getDashboardStats(db, userId) {
  const uid = Number(userId);

  // Totals
  const totalsRow = db.prepare(`
    SELECT
      COUNT(*) AS total_applications,
      SUM(CASE WHEN result = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN result = 'passed' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN result = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn
    FROM applications
    WHERE user_id = ?
  `).get(uid);

  const jobsRow = db.prepare(`
    SELECT
      COUNT(*) AS total_jobs,
      SUM(CASE WHEN is_bookmarked = 1 THEN 1 ELSE 0 END) AS bookmarked_jobs
    FROM job_posts WHERE user_id = ?
  `).get(uid);

  const companiesCount = db.prepare('SELECT COUNT(*) AS cnt FROM companies WHERE user_id = ?').get(uid).cnt;
  const eventsCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM events
    WHERE user_id = ? AND date(starts_at) >= date('now') AND date(starts_at) <= date('now', '+14 days')
  `).get(uid).cnt;

  const essaysCount = db.prepare('SELECT COUNT(*) AS cnt FROM essays WHERE user_id = ?').get(uid).cnt;
  const essayVersionsCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM essay_versions ev
    INNER JOIN essays e ON e.id = ev.essay_id
    WHERE e.user_id = ?
  `).get(uid).cnt;

  const totals = {
    total: totalsRow ? Number(totalsRow.total_applications) || 0 : 0,
    totalApplications: totalsRow ? Number(totalsRow.total_applications) || 0 : 0,
    applicationsCount: totalsRow ? Number(totalsRow.total_applications) || 0 : 0,
    in_progress: totalsRow ? Number(totalsRow.in_progress) || 0 : 0,
    inProgress: totalsRow ? Number(totalsRow.in_progress) || 0 : 0,
    inProgressCount: totalsRow ? Number(totalsRow.in_progress) || 0 : 0,
    passed: totalsRow ? Number(totalsRow.passed) || 0 : 0,
    passedCount: totalsRow ? Number(totalsRow.passed) || 0 : 0,
    failed: totalsRow ? Number(totalsRow.failed) || 0 : 0,
    withdrawn: totalsRow ? Number(totalsRow.withdrawn) || 0 : 0,
    jobsCount: jobsRow ? Number(jobsRow.total_jobs) || 0 : 0,
    bookmarkedJobsCount: jobsRow ? Number(jobsRow.bookmarked_jobs) || 0 : 0,
    companiesCount: Number(companiesCount) || 0,
    upcomingEventsCount: Number(eventsCount) || 0,
    essaysCount: Number(essaysCount) || 0,
    essayVersionsCount: Number(essayVersionsCount) || 0,
  };

  // Stage distribution of in_progress applications (in order)
  const stageRows = db.prepare(`
    SELECT stage, COUNT(*) AS cnt
    FROM applications
    WHERE user_id = ? AND result = 'in_progress'
    GROUP BY stage
  `).all(uid);
  const stageMap = Object.fromEntries(stageRows.map((r) => [r.stage, r.cnt]));
  const stageDistribution = {
    stages: APPLICATION_STAGES,
    labels: APPLICATION_STAGES.map((s) => STAGE_LABELS[s] || s),
    counts: APPLICATION_STAGES.map((s) => stageMap[s] || 0),
    total: totals.inProgress,
  };

  // Result distribution
  const resultKeys = ['in_progress', 'passed', 'failed', 'withdrawn'];
  const resultRows = db.prepare(`
    SELECT result, COUNT(*) AS cnt
    FROM applications
    WHERE user_id = ?
    GROUP BY result
  `).all(uid);
  const resultMap = Object.fromEntries(resultRows.map((r) => [r.result, r.cnt]));
  const resultDistribution = {
    results: resultKeys,
    labels: resultKeys.map((r) => RESULT_LABELS[r] || r),
    counts: resultKeys.map((r) => resultMap[r] || 0),
    total: totals.totalApplications,
  };

  // Monthly trend for the last 6 months (applied_at fallback created_at)
  const monthItems = getLast6Months();
  const monthlyRows = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(applied_at, created_at)) AS ym, COUNT(*) AS cnt
    FROM applications
    WHERE user_id = ?
    GROUP BY ym
  `).all(uid);
  const monthMap = Object.fromEntries(monthlyRows.map((r) => [r.ym, r.cnt]));
  const monthlyCounts = monthItems.map((m) => monthMap[m.key] || 0);
  const monthlyTrend = {
    months: monthItems.map((m) => m.key),
    labels: monthItems.map((m) => m.label),
    counts: monthlyCounts,
    total: monthlyCounts.reduce((a, b) => a + b, 0),
  };

  // Upcoming deadlines (next 14 days, limit 8)
  const deadlineRows = db.prepare(`
    SELECT
      jp.id, jp.title, jp.position, jp.employment_type, jp.deadline, jp.is_bookmarked,
      c.id AS company_id, c.name AS company_name,
      a.id AS application_id, a.stage AS application_stage, a.result AS application_result
    FROM job_posts jp
    INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
    LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
    WHERE jp.user_id = ?
      AND jp.deadline IS NOT NULL
      AND date(jp.deadline) >= date('now')
      AND date(jp.deadline) <= date('now', '+14 days')
    ORDER BY jp.deadline ASC, jp.id ASC
    LIMIT 8
  `).all(uid);
  const upcomingDeadlines = deadlineRows.map((r) => ({
    ...r,
    dday: calculateDday(r.deadline),
    stage_label: r.application_stage ? STAGE_LABELS[r.application_stage] : null,
    result_label: r.application_result ? RESULT_LABELS[r.application_result] : null,
  }));

  // Upcoming events (next 14 days, limit 8)
  const eventRows = db.prepare(`
    SELECT
      e.id, e.title, e.type, e.starts_at, e.memo,
      a.id AS application_id, a.stage AS application_stage,
      jp.title AS job_title, c.name AS company_name
    FROM events e
    LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
    LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
    LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
    WHERE e.user_id = ?
      AND date(e.starts_at) >= date('now')
      AND date(e.starts_at) <= date('now', '+14 days')
    ORDER BY e.starts_at ASC, e.id ASC
    LIMIT 8
  `).all(uid);
  const upcomingEvents = eventRows.map((r) => ({
    ...r,
    dday: calculateDday(r.starts_at ? r.starts_at.slice(0, 10) : ''),
    type_label: EVENT_TYPE_LABELS[r.type] || r.type,
  }));

  // Recent stage_logs activity (limit 8)
  const activityRows = db.prepare(`
    SELECT
      sl.id, sl.application_id, sl.from_stage, sl.to_stage, sl.from_result, sl.to_result,
      sl.changed_at, c.name AS company_name, jp.title AS job_title, jp.position AS job_position
    FROM stage_logs sl
    INNER JOIN applications a ON a.id = sl.application_id
    INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
    INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
    WHERE a.user_id = ?
    ORDER BY sl.changed_at DESC, sl.id DESC
    LIMIT 8
  `).all(uid);
  const recentActivity = activityRows.map((r) => ({
    ...r,
    from_stage_label: r.from_stage ? STAGE_LABELS[r.from_stage] : null,
    to_stage_label: STAGE_LABELS[r.to_stage] || r.to_stage,
    from_result_label: r.from_result ? RESULT_LABELS[r.from_result] : null,
    to_result_label: RESULT_LABELS[r.to_result] || r.to_result,
  }));

  const essays = {
    count: Number(essaysCount) || 0,
    totalVersions: Number(essayVersionsCount) || 0,
  };

  return {
    totals,
    stageDistribution,
    resultDistribution,
    monthlyTrend,
    monthlyApplications: monthlyTrend,
    upcomingDeadlines,
    upcomingEvents,
    recentActivity,
    essays,
  };
}

function serializeDashboardData(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

module.exports = {
  getDashboardStats,
  serializeDashboardData,
  getLast6Months,
  computeConversionStats,
  getDashboardHome,
};
