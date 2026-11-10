const { getActiveDatabase } = require('../db/connection');
const { APPLICATION_STAGES } = require('../middleware/validation');
const { getJobPostById } = require('./jobsService');

function buildFilterClause(userId, { stage = '', result = '', q = '' } = {}) {
  const conditions = ['a.user_id = ?'];
  const params = [userId];
  if (stage) {
    conditions.push('a.stage = ?');
    params.push(stage);
  }
  if (result && result !== 'all') {
    conditions.push('a.result = ?');
    params.push(result);
  }
  const keyword = String(q || '').trim();
  if (keyword) {
    conditions.push('(c.name LIKE ? OR jp.title LIKE ? OR jp.position LIKE ? OR a.memo LIKE ?)');
    const likeParam = `%${keyword}%`;
    params.push(likeParam, likeParam, likeParam, likeParam);
  }
  return { whereSql: conditions.join(' AND '), params };
}

const BASE_SELECT = `
  SELECT a.*, jp.title AS job_title, jp.position AS job_position,
    jp.employment_type AS employment_type, jp.deadline AS job_deadline,
    jp.company_id AS company_id, c.name AS company_name
`;
const BASE_JOINS = `
  FROM applications a
  INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
  INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
`;

function listApplications(db, userId, filters = {}) {
  const { whereSql, params } = buildFilterClause(userId, filters);
  const sql = `${BASE_SELECT} ${BASE_JOINS} WHERE ${whereSql} ORDER BY a.updated_at DESC, a.id DESC`;
  return db.prepare(sql).all(...params);
}

function listBoardApplications(db, userId, { result = '', q = '' } = {}) {
  const { whereSql, params } = buildFilterClause(userId, { result, q });
  const sql = `
    ${BASE_SELECT},
    (SELECT e.title FROM events e WHERE e.application_id = a.id AND e.user_id = a.user_id AND date(e.starts_at) >= date('now') ORDER BY e.starts_at ASC, e.id ASC LIMIT 1) AS next_event_title,
    (SELECT substr(e.starts_at, 1, 10) FROM events e WHERE e.application_id = a.id AND e.user_id = a.user_id AND date(e.starts_at) >= date('now') ORDER BY e.starts_at ASC, e.id ASC LIMIT 1) AS next_event_date
    ${BASE_JOINS}
    WHERE ${whereSql}
    ORDER BY a.board_order ASC, a.updated_at DESC, a.id DESC
  `;
  const rows = db.prepare(sql).all(...params);
  const columns = Object.fromEntries(APPLICATION_STAGES.map((st) => [st, []]));
  for (const row of rows) {
    if (columns[row.stage]) columns[row.stage].push(row);
  }
  return { applications: rows, columns };
}

function getApplicationById(db, userId, id) {
  const appRow = db
    .prepare(`${BASE_SELECT}, jp.url AS job_url, c.industry AS company_industry ${BASE_JOINS} WHERE a.id = ? AND a.user_id = ?`)
    .get(Number(id), userId);
  if (!appRow) return null;

  const stageLogs = db
    .prepare('SELECT * FROM stage_logs WHERE application_id = ? ORDER BY changed_at DESC, id DESC')
    .all(appRow.id);
  const events = db
    .prepare('SELECT * FROM events WHERE application_id = ? AND user_id = ? ORDER BY starts_at ASC, id ASC')
    .all(appRow.id, userId);

  return { ...appRow, stageLogs, events };
}

function createApplication(
  db,
  userId,
  { job_post_id, stage = 'document', result = 'in_progress', board_order, applied_at = null, memo = '' }
) {
  return db.transaction(() => {
    const jobPost = getJobPostById(db, userId, job_post_id);
    if (!jobPost) {
      const err = new Error('선택한 채용 공고를 찾을 수 없습니다.');
      err.code = 'JOB_POST_NOT_FOUND';
      throw err;
    }
    const existingForJob = db.prepare('SELECT id FROM applications WHERE job_post_id = ?').get(jobPost.id);
    if (existingForJob) {
      const err = new Error('이미 해당 채용 공고에 대한 지원 내역이 존재합니다.');
      err.code = 'DUPLICATE_APPLICATION';
      throw err;
    }

    let orderValue = board_order;
    if (orderValue === undefined || orderValue === null || orderValue === '') {
      const maxRow = db
        .prepare('SELECT COALESCE(MAX(board_order), -1) + 1 AS next_order FROM applications WHERE user_id = ? AND stage = ?')
        .get(userId, stage);
      orderValue = maxRow ? maxRow.next_order : 0;
    }

    const info = db
      .prepare('INSERT INTO applications (user_id, job_post_id, stage, result, board_order, applied_at, memo) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        userId,
        jobPost.id,
        stage,
        result,
        Number(orderValue) || 0,
        applied_at && String(applied_at).trim() ? String(applied_at).trim() : null,
        String(memo || '').trim()
      );

    const appId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result) VALUES (?, ?, ?, ?, ?)')
      .run(appId, null, stage, null, result);

    return getApplicationById(db, userId, appId);
  })();
}

function updateApplication(db, userId, id, { stage, result, board_order, applied_at = null, memo = '' }) {
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(Number(id), userId);
    if (!existing) return null;

    const nextStage = stage || existing.stage;
    const nextResult = result || existing.result;

    if (existing.stage !== nextStage && (board_order === undefined || board_order === null || board_order === '')) {
      db.prepare(
        "UPDATE applications SET applied_at = ?, memo = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
      ).run(
        applied_at && String(applied_at).trim() ? String(applied_at).trim() : null,
        String(memo || '').trim(),
        existing.id,
        userId
      );
      return moveApplication(db, userId, existing.id, nextStage, undefined, nextResult);
    }

    let nextBoardOrder = existing.board_order;
    if (board_order !== undefined && board_order !== null && board_order !== '') {
      nextBoardOrder = Number(board_order);
      if (typeof board_order === 'boolean' || !Number.isInteger(nextBoardOrder) || nextBoardOrder < 0) {
        const err = new Error('유효하지 않은 순서(board_order)입니다.');
        err.status = 422;
        err.expose = true;
        throw err;
      }
    }

    db.prepare(
      "UPDATE applications SET stage = ?, result = ?, board_order = ?, applied_at = ?, memo = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(
      nextStage,
      nextResult,
      nextBoardOrder,
      applied_at && String(applied_at).trim() ? String(applied_at).trim() : null,
      String(memo || '').trim(),
      existing.id,
      userId
    );

    if (existing.stage !== nextStage || existing.result !== nextResult) {
      db.prepare('INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result) VALUES (?, ?, ?, ?, ?)')
        .run(existing.id, existing.stage, nextStage, existing.result, nextResult);
    }

    return getApplicationById(db, userId, existing.id);
  })();
}

function moveApplication(...args) {
  const hasDbArg = Boolean(args[0] && typeof args[0].transaction === 'function');
  const [db, userId, id, toStage, toIndex, result] = hasDbArg ? args : [getActiveDatabase(), ...args];
  const uid = Number(userId);

  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(Number(id), uid);
    if (!existing) return null;

    const oldStage = existing.stage;
    const nextStage = toStage || existing.stage;
    const nextResult = result !== undefined && result !== null && result !== '' ? String(result) : existing.result;

    const selectColumnStmt = db.prepare(
      'SELECT id FROM applications WHERE user_id = ? AND stage = ? AND id != ? ORDER BY board_order ASC, updated_at DESC, id DESC'
    );
    const updateOrderStmt = db.prepare('UPDATE applications SET board_order = ? WHERE id = ? AND user_id = ?');

    if (oldStage !== nextStage) {
      const oldSiblings = selectColumnStmt.all(uid, oldStage, existing.id);
      for (let i = 0; i < oldSiblings.length; i += 1) {
        updateOrderStmt.run(i, oldSiblings[i].id, uid);
      }
    }

    const targetSiblings = selectColumnStmt.all(uid, nextStage, existing.id);
    const hasIndex = toIndex !== undefined && toIndex !== null && toIndex !== '' && !Number.isNaN(Number(toIndex));
    const clampedIndex = hasIndex
      ? Math.max(0, Math.min(targetSiblings.length, Math.trunc(Number(toIndex))))
      : targetSiblings.length;

    targetSiblings.splice(clampedIndex, 0, { id: existing.id });

    db.prepare("UPDATE applications SET stage = ?, result = ?, board_order = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(nextStage, nextResult, clampedIndex, existing.id, uid);

    for (let i = 0; i < targetSiblings.length; i += 1) {
      updateOrderStmt.run(i, targetSiblings[i].id, uid);
    }

    if (existing.stage !== nextStage || existing.result !== nextResult) {
      db.prepare('INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result) VALUES (?, ?, ?, ?, ?)')
        .run(existing.id, existing.stage, nextStage, existing.result, nextResult);
    }

    return getApplicationById(db, uid, existing.id);
  })();
}

function patchApplicationStage(db, userId, id, { stage, result, index, board_order }) {
  if (index !== undefined && index !== null && index !== '') {
    return moveApplication(db, userId, id, stage, Number(index), result);
  }
  if (board_order !== undefined && board_order !== null && board_order !== '') {
    const existing = getApplicationById(db, userId, id);
    if (!existing) return null;
    return updateApplication(db, userId, id, {
      stage,
      result,
      board_order,
      applied_at: existing.applied_at,
      memo: existing.memo,
    });
  }
  return moveApplication(db, userId, id, stage, undefined, result);
}

function deleteApplication(db, userId, id) {
  const uid = Number(userId);
  const appId = Number(id);
  return db.transaction(() => {
    const existing = db.prepare('SELECT id, stage FROM applications WHERE id = ? AND user_id = ?').get(appId, uid);
    if (!existing) return false;

    const res = db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(appId, uid);
    if (res.changes === 0) return false;

    const remaining = db
      .prepare('SELECT id FROM applications WHERE user_id = ? AND stage = ? ORDER BY board_order ASC, updated_at DESC, id DESC')
      .all(uid, existing.stage);

    const updateOrderStmt = db.prepare('UPDATE applications SET board_order = ? WHERE id = ? AND user_id = ?');
    for (let i = 0; i < remaining.length; i += 1) {
      updateOrderStmt.run(i, remaining[i].id, uid);
    }

    return true;
  })();
}

module.exports = {
  listApplications,
  listBoardApplications,
  getApplicationById,
  createApplication,
  updateApplication,
  moveApplication,
  patchApplicationStage,
  deleteApplication,
};
