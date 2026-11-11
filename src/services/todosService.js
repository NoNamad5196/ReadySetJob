const {
  TODO_CATEGORIES,
  TODO_CATEGORY_LABELS,
  calculateDday,
  isValidDate,
} = require('../middleware/validation');

const TODO_SELECT = `
  SELECT
    t.*,
    a.stage AS application_stage,
    a.result AS application_result,
    jp.title AS job_title,
    jp.position AS job_position,
    c.id AS company_id,
    c.name AS company_name
  FROM todos t
  LEFT JOIN applications a ON a.id = t.application_id AND a.user_id = t.user_id
  LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = t.user_id
  LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = t.user_id
`;

function enrichTodo(row) {
  if (!row) return null;
  return {
    ...row,
    is_done: Number(row.is_done) ? 1 : 0,
    category_label: TODO_CATEGORY_LABELS[row.category] || '기타',
    dday: row.due_date ? calculateDday(row.due_date) : null,
  };
}

function normalizeFilter(filter) {
  const f = String(filter || '').trim();
  if (f === 'today' || f === '오늘') return 'today';
  if (f === 'upcoming' || f === '예정') return 'upcoming';
  if (f === 'done' || f === 'completed' || f === '완료') return 'done';
  if (f === 'open' || f === '미완료') return 'open';
  return 'all';
}

function listTodos(db, userId, { filter = 'all', category = '', application_id = null } = {}) {
  const uid = Number(userId);
  const normalizedFilter = normalizeFilter(filter);
  const conds = ['t.user_id = ?'];
  const params = [uid];

  if (normalizedFilter === 'today') {
    conds.push("t.is_done = 0 AND (t.due_date IS NULL OR date(t.due_date) <= date('now'))");
  } else if (normalizedFilter === 'upcoming') {
    conds.push("t.is_done = 0 AND t.due_date IS NOT NULL AND date(t.due_date) > date('now')");
  } else if (normalizedFilter === 'done') {
    conds.push('t.is_done = 1');
  } else if (normalizedFilter === 'open') {
    conds.push('t.is_done = 0');
  }

  const trimmedCat = String(category || '').trim();
  if (trimmedCat && TODO_CATEGORIES.includes(trimmedCat)) {
    conds.push('t.category = ?');
    params.push(trimmedCat);
  }

  if (application_id !== null && application_id !== undefined && String(application_id).trim() !== '') {
    conds.push('t.application_id = ?');
    params.push(Number(application_id));
  }

  const sql = `
    ${TODO_SELECT}
    WHERE ${conds.join(' AND ')}
    ORDER BY
      t.is_done ASC,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END ASC,
      t.due_date ASC,
      t.id DESC
  `;
  return db.prepare(sql).all(...params).map(enrichTodo);
}

function getTodoById(db, userId, id) {
  const row = db
    .prepare(`${TODO_SELECT} WHERE t.id = ? AND t.user_id = ?`)
    .get(Number(id), Number(userId));
  return enrichTodo(row);
}

function assertOwnedApplication(db, userId, applicationId) {
  if (applicationId === null || applicationId === undefined || String(applicationId).trim() === '') {
    return null;
  }
  const appId = Number(applicationId);
  const row = db
    .prepare('SELECT id FROM applications WHERE id = ? AND user_id = ?')
    .get(appId, Number(userId));
  if (!row) {
    const err = new Error('연결할 지원 내역을 찾을 수 없습니다.');
    err.code = 'APPLICATION_NOT_FOUND';
    err.status = 404;
    err.expose = true;
    throw err;
  }
  return row.id;
}

function validateTodoFields({ title, category = 'other', due_date = null }) {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    return '할 일 제목을 입력해 주세요.';
  }
  if (trimmedTitle.length > 120) {
    return '할 일 제목은 120자 이하여야 합니다.';
  }
  const trimmedCategory = String(category || 'other').trim();
  if (!TODO_CATEGORIES.includes(trimmedCategory)) {
    return '올바른 할 일 분류를 선택해 주세요.';
  }
  const trimmedDue = due_date !== null && due_date !== undefined ? String(due_date).trim() : '';
  if (trimmedDue && !isValidDate(trimmedDue)) {
    return '마감일 형식이 올바르지 않습니다 (YYYY-MM-DD).';
  }
  return null;
}

function createTodo(db, userId, { title, category = 'other', due_date = null, application_id = null }) {
  const uid = Number(userId);
  const errMsg = validateTodoFields({ title, category, due_date });
  if (errMsg) {
    const err = new Error(errMsg);
    err.status = 422;
    err.expose = true;
    throw err;
  }

  const targetAppId = assertOwnedApplication(db, uid, application_id);
  const trimmedDue = due_date && String(due_date).trim() ? String(due_date).trim() : null;

  const info = db
    .prepare(`
      INSERT INTO todos (user_id, application_id, title, category, due_date)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(uid, targetAppId, String(title).trim(), String(category || 'other').trim(), trimmedDue);

  return getTodoById(db, uid, info.lastInsertRowid);
}

function updateTodo(db, userId, id, { title, category, due_date, application_id }) {
  const uid = Number(userId);
  const existing = getTodoById(db, uid, id);
  if (!existing) return null;

  const nextTitle = title !== undefined ? String(title).trim() : existing.title;
  const nextCategory = category !== undefined && String(category).trim() !== ''
    ? String(category).trim()
    : existing.category;
  const nextDue = due_date !== undefined
    ? (due_date && String(due_date).trim() ? String(due_date).trim() : null)
    : existing.due_date;

  const errMsg = validateTodoFields({ title: nextTitle, category: nextCategory, due_date: nextDue });
  if (errMsg) {
    const err = new Error(errMsg);
    err.status = 422;
    err.expose = true;
    throw err;
  }

  const nextAppId = application_id !== undefined
    ? assertOwnedApplication(db, uid, application_id)
    : existing.application_id;

  db.prepare(`
    UPDATE todos
    SET title = ?, category = ?, due_date = ?, application_id = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(nextTitle, nextCategory, nextDue, nextAppId, existing.id, uid);

  return getTodoById(db, uid, existing.id);
}

function setTodoDone(db, userId, id, isDone) {
  const uid = Number(userId);
  const existing = getTodoById(db, uid, id);
  if (!existing) return null;

  const nextDone = isDone ? 1 : 0;
  db.prepare(`
    UPDATE todos
    SET is_done = ?,
        done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(nextDone, nextDone, existing.id, uid);

  return getTodoById(db, uid, existing.id);
}

function toggleTodo(db, userId, id) {
  const uid = Number(userId);
  const existing = getTodoById(db, uid, id);
  if (!existing) return null;
  return setTodoDone(db, uid, existing.id, existing.is_done ? 0 : 1);
}

function deleteTodo(db, userId, id) {
  const info = db
    .prepare('DELETE FROM todos WHERE id = ? AND user_id = ?')
    .run(Number(id), Number(userId));
  return info.changes > 0;
}

module.exports = {
  normalizeFilter,
  validateTodoFields,
  listTodos,
  getTodoById,
  createTodo,
  updateTodo,
  setTodoDone,
  toggleTodo,
  deleteTodo,
};
