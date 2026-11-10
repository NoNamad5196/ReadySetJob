function listEvents(db, userId) {
  return db
    .prepare(`
      SELECT
        e.*,
        a.stage AS application_stage,
        jp.title AS job_title,
        c.name AS company_name
      FROM events e
      LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
      LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
      LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
      WHERE e.user_id = ?
      ORDER BY e.starts_at ASC, e.id ASC
    `)
    .all(userId);
}

function getEventById(db, userId, id) {
  return (
    db
      .prepare('SELECT * FROM events WHERE id = ? AND user_id = ?')
      .get(Number(id), userId) || null
  );
}

function createEvent(db, userId, { application_id = null, title, type = 'other', starts_at, memo = '' }) {
  let targetAppId = null;
  if (application_id !== null && application_id !== undefined && String(application_id).trim() !== '') {
    const appRow = db
      .prepare('SELECT id FROM applications WHERE id = ? AND user_id = ?')
      .get(Number(application_id), userId);
    if (!appRow) {
      const err = new Error('연결할 지원 내역을 찾을 수 없습니다.');
      err.code = 'APPLICATION_NOT_FOUND';
      err.status = 404;
      err.expose = true;
      throw err;
    }
    targetAppId = appRow.id;
  }

  const info = db
    .prepare(`
      INSERT INTO events (user_id, application_id, title, type, starts_at, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      userId,
      targetAppId,
      String(title).trim(),
      type,
      String(starts_at).trim(),
      String(memo || '').trim()
    );

  return getEventById(db, userId, info.lastInsertRowid);
}

function deleteEvent(db, userId, id) {
  const info = db
    .prepare('DELETE FROM events WHERE id = ? AND user_id = ?')
    .run(Number(id), userId);
  return info.changes > 0;
}

module.exports = {
  listEvents,
  getEventById,
  createEvent,
  deleteEvent,
};
