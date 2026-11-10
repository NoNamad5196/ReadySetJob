const { getJobPostById } = require('./jobsService');

function listApplications(db, userId, { stage = '', result = '', q = '' } = {}) {
  const conditions = ['a.user_id = ?'];
  const params = [userId];

  if (stage) {
    conditions.push('a.stage = ?');
    params.push(stage);
  }

  if (result) {
    conditions.push('a.result = ?');
    params.push(result);
  }

  const keyword = String(q || '').trim();
  if (keyword) {
    conditions.push('(c.name LIKE ? OR jp.title LIKE ? OR jp.position LIKE ? OR a.memo LIKE ?)');
    const likeParam = `%${keyword}%`;
    params.push(likeParam, likeParam, likeParam, likeParam);
  }

  const sql = `
    SELECT
      a.*,
      jp.title AS job_title,
      jp.position AS job_position,
      jp.employment_type AS employment_type,
      jp.deadline AS job_deadline,
      jp.company_id AS company_id,
      c.name AS company_name
    FROM applications a
    INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
    INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.updated_at DESC, a.id DESC
  `;

  return db.prepare(sql).all(...params);
}

function getApplicationById(db, userId, id) {
  const appRow = db
    .prepare(`
      SELECT
        a.*,
        jp.title AS job_title,
        jp.position AS job_position,
        jp.employment_type AS employment_type,
        jp.deadline AS job_deadline,
        jp.url AS job_url,
        jp.company_id AS company_id,
        c.name AS company_name,
        c.industry AS company_industry
      FROM applications a
      INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
      INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
      WHERE a.id = ? AND a.user_id = ?
    `)
    .get(Number(id), userId);

  if (!appRow) {
    return null;
  }

  const stageLogs = db
    .prepare(`
      SELECT *
      FROM stage_logs
      WHERE application_id = ?
      ORDER BY changed_at DESC, id DESC
    `)
    .all(appRow.id);

  const events = db
    .prepare(`
      SELECT *
      FROM events
      WHERE application_id = ? AND user_id = ?
      ORDER BY starts_at ASC, id ASC
    `)
    .all(appRow.id, userId);

  return {
    ...appRow,
    stageLogs,
    events,
  };
}

function createApplication(
  db,
  userId,
  {
    job_post_id,
    stage = 'document',
    result = 'in_progress',
    board_order = 0,
    applied_at = null,
    memo = '',
  }
) {
  const tx = db.transaction(() => {
    const jobPost = getJobPostById(db, userId, job_post_id);
    if (!jobPost) {
      const err = new Error('선택한 채용 공고를 찾을 수 없습니다.');
      err.code = 'JOB_POST_NOT_FOUND';
      throw err;
    }

    const existingForJob = db
      .prepare('SELECT id FROM applications WHERE job_post_id = ?')
      .get(jobPost.id);
    if (existingForJob) {
      const err = new Error('이미 해당 채용 공고에 대한 지원 내역이 존재합니다.');
      err.code = 'DUPLICATE_APPLICATION';
      throw err;
    }

    const info = db
      .prepare(`
        INSERT INTO applications (user_id, job_post_id, stage, result, board_order, applied_at, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        userId,
        jobPost.id,
        stage,
        result,
        Number(board_order) || 0,
        applied_at && String(applied_at).trim() ? String(applied_at).trim() : null,
        String(memo || '').trim()
      );

    const appId = Number(info.lastInsertRowid);
    db.prepare(`
      INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result)
      VALUES (?, ?, ?, ?, ?)
    `).run(appId, null, stage, null, result);

    return getApplicationById(db, userId, appId);
  });

  return tx();
}

function updateApplication(
  db,
  userId,
  id,
  { stage, result, board_order, applied_at = null, memo = '' }
) {
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?')
      .get(Number(id), userId);
    if (!existing) {
      return null;
    }

    const nextStage = stage || existing.stage;
    const nextResult = result || existing.result;
    const nextBoardOrder =
      board_order !== undefined && board_order !== ''
        ? Number(board_order)
        : existing.board_order;

    db.prepare(`
      UPDATE applications
      SET stage = ?,
          result = ?,
          board_order = ?,
          applied_at = ?,
          memo = ?,
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      nextStage,
      nextResult,
      nextBoardOrder,
      applied_at && String(applied_at).trim() ? String(applied_at).trim() : null,
      String(memo || '').trim(),
      existing.id,
      userId
    );

    if (existing.stage !== nextStage || existing.result !== nextResult) {
      db.prepare(`
        INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result)
        VALUES (?, ?, ?, ?, ?)
      `).run(existing.id, existing.stage, nextStage, existing.result, nextResult);
    }

    return getApplicationById(db, userId, existing.id);
  });

  return tx();
}

function patchApplicationStage(db, userId, id, { stage, result, board_order }) {
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?')
      .get(Number(id), userId);
    if (!existing) {
      return null;
    }

    const nextStage = stage || existing.stage;
    const nextResult = result || existing.result;
    const nextBoardOrder =
      board_order !== undefined && board_order !== null && board_order !== ''
        ? Number(board_order)
        : existing.board_order;

    db.prepare(`
      UPDATE applications
      SET stage = ?,
          result = ?,
          board_order = ?,
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(nextStage, nextResult, nextBoardOrder, existing.id, userId);

    db.prepare(`
      INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result)
      VALUES (?, ?, ?, ?, ?)
    `).run(existing.id, existing.stage, nextStage, existing.result, nextResult);

    return getApplicationById(db, userId, existing.id);
  });

  return tx();
}

function deleteApplication(db, userId, id) {
  const info = db
    .prepare('DELETE FROM applications WHERE id = ? AND user_id = ?')
    .run(Number(id), userId);
  return info.changes > 0;
}

module.exports = {
  listApplications,
  getApplicationById,
  createApplication,
  updateApplication,
  patchApplicationStage,
  deleteApplication,
};
