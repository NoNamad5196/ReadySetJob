const { getActiveDatabase } = require('../db/connection');

function resolveDb(args) {
  if (args[0] && typeof args[0].prepare === 'function') {
    return { db: args[0], rest: args.slice(1) };
  }
  return { db: getActiveDatabase(), rest: args };
}

function assertOwnedApplication(db, userId, applicationId) {
  const uid = Number(userId);
  const appId = Number(applicationId);
  if (!uid || !appId) {
    const err = new Error('요청한 지원 내역을 찾을 수 없습니다.');
    err.status = 404;
    err.expose = true;
    throw err;
  }
  const row = db
    .prepare('SELECT id FROM applications WHERE id = ? AND user_id = ?')
    .get(appId, uid);
  if (!row) {
    const err = new Error('요청한 지원 내역을 찾을 수 없습니다.');
    err.status = 404;
    err.expose = true;
    throw err;
  }
  return appId;
}

function list(...args) {
  const { db, rest } = resolveDb(args);
  const [userId, applicationId] = rest;
  const uid = Number(userId);
  const appId = assertOwnedApplication(db, uid, applicationId);

  return db
    .prepare(
      'SELECT * FROM interview_questions WHERE user_id = ? AND application_id = ? ORDER BY created_at ASC, id ASC'
    )
    .all(uid, appId);
}

function createManual(...args) {
  const { db, rest } = resolveDb(args);
  const [userId, applicationId, question] = rest;
  const uid = Number(userId);

  const trimmed = typeof question === 'string' ? question.trim() : '';
  if (!trimmed || trimmed.length > 500) {
    const err = new Error('면접 질문을 1자 이상 500자 이하로 입력해 주세요.');
    err.status = 422;
    err.expose = true;
    throw err;
  }

  const appId = assertOwnedApplication(db, uid, applicationId);
  const info = db
    .prepare(
      'INSERT INTO interview_questions (user_id, application_id, question, source) VALUES (?, ?, ?, ?)'
    )
    .run(uid, appId, trimmed, 'manual');

  return db
    .prepare('SELECT * FROM interview_questions WHERE id = ?')
    .get(Number(info.lastInsertRowid));
}

function deleteQuestion(...args) {
  const { db, rest } = resolveDb(args);
  const [userId, id] = rest;
  const uid = Number(userId);
  const qid = Number(id);

  if (!uid || !qid) {
    const err = new Error('요청한 면접 질문을 찾을 수 없습니다.');
    err.status = 404;
    err.expose = true;
    throw err;
  }

  const existing = db
    .prepare(
      `SELECT iq.id
       FROM interview_questions iq
       INNER JOIN applications a ON a.id = iq.application_id AND a.user_id = iq.user_id
       WHERE iq.id = ? AND iq.user_id = ?`
    )
    .get(qid, uid);

  if (!existing) {
    const err = new Error('요청한 면접 질문을 찾을 수 없습니다.');
    err.status = 404;
    err.expose = true;
    throw err;
  }

  db.prepare('DELETE FROM interview_questions WHERE id = ? AND user_id = ?').run(qid, uid);
  return true;
}

function createMany(...args) {
  const { db, rest } = resolveDb(args);
  const [userId, applicationId, questions, source = 'ai'] = rest;
  const uid = Number(userId);

  return db.transaction(() => {
    const appId = assertOwnedApplication(db, uid, applicationId);
    if (!Array.isArray(questions)) {
      const err = new Error('면접 질문 목록 형식이 올바르지 않습니다.');
      err.status = 422;
      err.expose = true;
      throw err;
    }

    const insertStmt = db.prepare(
      'INSERT INTO interview_questions (user_id, application_id, question, source) VALUES (?, ?, ?, ?)'
    );

    const ids = [];
    for (const q of questions) {
      const trimmed = typeof q === 'string' ? q.trim() : '';
      if (!trimmed) continue;
      if (trimmed.length > 500) {
        const err = new Error('면접 질문은 500자 이하여야 합니다.');
        err.status = 422;
        err.expose = true;
        throw err;
      }
      const info = insertStmt.run(uid, appId, trimmed, source);
      ids.push(Number(info.lastInsertRowid));
    }

    if (ids.length === 0) return [];

    return db
      .prepare(
        `SELECT * FROM interview_questions WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC, id ASC`
      )
      .all(...ids);
  })();
}

module.exports = {
  assertOwnedApplication,
  list,
  createManual,
  delete: deleteQuestion,
  deleteQuestion,
  createMany,
};
