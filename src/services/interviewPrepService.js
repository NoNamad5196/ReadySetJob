const { STAGE_LABELS, RESULT_LABELS, calculateDday } = require('../middleware/validation');

function loadAppInterviewArtifacts(db, userId, applicationId) {
  if (!applicationId) {
    return { essays: [], interviewQuestions: [] };
  }
  const uid = Number(userId);
  const appId = Number(applicationId);

  const essays = db
    .prepare(`
      SELECT
        e.id,
        e.title,
        e.updated_at,
        (SELECT COUNT(*) FROM essay_questions eq WHERE eq.essay_id = e.id) AS question_count
      FROM essays e
      WHERE e.user_id = ? AND e.application_id = ?
      ORDER BY e.updated_at DESC, e.id DESC
    `)
    .all(uid, appId);

  const interviewQuestions = db
    .prepare(`
      SELECT id, user_id, application_id, question, source, created_at
      FROM interview_questions
      WHERE user_id = ? AND application_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(uid, appId);

  return { essays, interviewQuestions };
}

function getInterviewPrepData(db, userId) {
  const uid = Number(userId);

  const eventRows = db
    .prepare(`
      SELECT
        e.id,
        e.application_id,
        e.title,
        e.type,
        e.starts_at,
        e.memo,
        a.stage AS application_stage,
        a.result AS application_result,
        jp.id AS job_post_id,
        jp.title AS job_title,
        jp.position AS job_position,
        c.id AS company_id,
        c.name AS company_name
      FROM events e
      LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
      LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
      LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
      WHERE e.user_id = ?
        AND e.type = 'interview'
        AND date(e.starts_at) >= date('now')
        AND date(e.starts_at) <= date('now', '+30 days')
      ORDER BY e.starts_at ASC, e.id ASC
    `)
    .all(uid);

  const scheduledAppIds = new Set();
  const upcomingInterviews = eventRows.map((row) => {
    if (row.application_id) {
      scheduledAppIds.add(Number(row.application_id));
    }
    const { essays, interviewQuestions } = loadAppInterviewArtifacts(
      db,
      uid,
      row.application_id
    );
    const datePart = row.starts_at ? String(row.starts_at).slice(0, 10) : '';
    return {
      ...row,
      dday: calculateDday(datePart),
      stage_label: row.application_stage ? STAGE_LABELS[row.application_stage] : null,
      result_label: row.application_result ? RESULT_LABELS[row.application_result] : null,
      application: row.application_id
        ? {
            id: row.application_id,
            company_id: row.company_id,
            company_name: row.company_name,
            job_post_id: row.job_post_id,
            job_title: row.job_title,
            job_position: row.job_position,
            stage: row.application_stage,
            stage_label: STAGE_LABELS[row.application_stage] || row.application_stage,
            result: row.application_result,
          }
        : null,
      essays,
      interviewQuestions,
      questions: interviewQuestions,
    };
  });

  const interviewStageApps = db
    .prepare(`
      SELECT
        a.*,
        jp.title AS job_title,
        jp.position AS job_position,
        jp.company_id AS company_id,
        c.name AS company_name
      FROM applications a
      INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
      INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
      WHERE a.user_id = ?
        AND a.stage IN ('interview1', 'interview2')
        AND a.result = 'in_progress'
      ORDER BY a.updated_at DESC, a.id DESC
    `)
    .all(uid);

  const unscheduledApplications = interviewStageApps
    .filter((app) => !scheduledAppIds.has(Number(app.id)))
    .map((app) => {
      const { essays, interviewQuestions } = loadAppInterviewArtifacts(db, uid, app.id);
      return {
        ...app,
        stage_label: STAGE_LABELS[app.stage] || app.stage,
        result_label: RESULT_LABELS[app.result] || app.result,
        essays,
        interviewQuestions,
        questions: interviewQuestions,
      };
    });

  return {
    upcomingInterviews,
    unscheduledApplications,
  };
}

module.exports = {
  getInterviewPrepData,
};
