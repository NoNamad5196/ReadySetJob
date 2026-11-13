const { normalizeTags } = require('../middleware/validation');

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function hydrateLibraryEntry(row) {
  if (!row) return null;
  const tagList = row.tags
    ? String(row.tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  return {
    ...row,
    body: row.body,
    content: row.body,
    tagList,
  };
}

function validateLibraryEntryInput({ title, question = '', body, content, tags = '' } = {}) {
  const cleanTitle = String(title ?? '').trim();
  const rawBody = body !== undefined && body !== null ? body : content;
  const cleanBody = String(rawBody ?? '').trim();
  const cleanQuestion = String(question ?? '').trim();
  const cleanTags = String(tags ?? '').trim();

  if (!cleanTitle) {
    return '제목을 입력해 주세요.';
  }
  if (cleanTitle.length > 200) {
    return '제목은 200자 이하여야 합니다.';
  }
  if (!cleanBody) {
    return '본문 내용을 입력해 주세요.';
  }
  if (cleanBody.length > 20000) {
    return '본문 내용은 20000자 이하여야 합니다.';
  }
  if (cleanQuestion.length > 500) {
    return '출처 문항은 500자 이하여야 합니다.';
  }
  if (cleanTags.length > 300) {
    return '태그는 300자 이하여야 합니다.';
  }
  return null;
}

function listLibraryEntries(db, userId, { q = '', tag = '' } = {}) {
  const uid = Number(userId);
  const conditions = ['user_id = ?'];
  const params = [uid];

  const keyword = String(q || '').trim();
  if (keyword) {
    const like = `%${escapeLike(keyword)}%`;
    conditions.push(
      "(title LIKE ? ESCAPE '\\' OR question LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }

  const tagFilter = String(tag || '').trim().toLowerCase();
  if (tagFilter) {
    const tagLike = `%,${escapeLike(tagFilter)},%`;
    conditions.push("(',' || lower(tags) || ',') LIKE ? ESCAPE '\\'");
    params.push(tagLike);
  }

  const rows = db
    .prepare(`
      SELECT *
      FROM essay_library
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC, id DESC
    `)
    .all(...params);

  return rows.map(hydrateLibraryEntry);
}

function listLibraryTags(db, userId) {
  const uid = Number(userId);
  const rows = db
    .prepare("SELECT tags FROM essay_library WHERE user_id = ? AND tags != '' ORDER BY updated_at DESC")
    .all(uid);
  const seen = new Set();
  const tags = [];
  for (const row of rows) {
    const parts = String(row.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (!seen.has(part)) {
        seen.add(part);
        tags.push(part);
      }
    }
  }
  return tags;
}

function getLibraryEntryById(db, userId, id) {
  const uid = Number(userId);
  const entryId = Number(id);
  if (!uid || !entryId) return null;
  const row = db
    .prepare('SELECT * FROM essay_library WHERE id = ? AND user_id = ?')
    .get(entryId, uid);
  return hydrateLibraryEntry(row);
}

function createLibraryEntry(db, userId, { title, question = '', body, content, tags = '' } = {}) {
  const uid = Number(userId);
  const rawBody = body !== undefined && body !== null ? body : content;
  const normalizedTags = normalizeTags(tags);

  const info = db
    .prepare(`
      INSERT INTO essay_library (user_id, title, question, body, tags)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      uid,
      String(title || '').trim(),
      String(question || '').trim(),
      String(rawBody || '').trim(),
      normalizedTags
    );

  return getLibraryEntryById(db, uid, Number(info.lastInsertRowid));
}

function createLibraryEntriesBulk(db, userId, entries = []) {
  const uid = Number(userId);
  const validItems = entries
    .map((item) => {
      const rawBody = item.body !== undefined && item.body !== null ? item.body : item.content;
      return {
        title: String(item.title || '').trim(),
        question: String(item.question || '').trim(),
        body: String(rawBody || '').trim(),
        tags: normalizeTags(item.tags || ''),
      };
    })
    .filter((item) => item.title.length > 0 && item.body.length > 0);

  if (validItems.length === 0) return [];

  const createdIds = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO essay_library (user_id, title, question, body, tags)
      VALUES (?, ?, ?, ?, ?)
    `);
    return validItems.map((item) => {
      const info = stmt.run(uid, item.title.slice(0, 200), item.question.slice(0, 500), item.body.slice(0, 20000), item.tags.slice(0, 300));
      return Number(info.lastInsertRowid);
    });
  })();

  return createdIds.map((id) => getLibraryEntryById(db, uid, id)).filter(Boolean);
}

function updateLibraryEntry(db, userId, id, { title, question = '', body, content, tags = '' } = {}) {
  const uid = Number(userId);
  const existing = getLibraryEntryById(db, uid, id);
  if (!existing) return null;

  const rawBody = body !== undefined && body !== null ? body : content;
  const normalizedTags = normalizeTags(tags);

  db.prepare(`
    UPDATE essay_library
    SET title = ?,
        question = ?,
        body = ?,
        tags = ?,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    String(title || '').trim(),
    String(question || '').trim(),
    String(rawBody || '').trim(),
    normalizedTags,
    existing.id,
    uid
  );

  return getLibraryEntryById(db, uid, existing.id);
}

function deleteLibraryEntry(db, userId, id) {
  const uid = Number(userId);
  const info = db
    .prepare('DELETE FROM essay_library WHERE id = ? AND user_id = ?')
    .run(Number(id), uid);
  return info.changes > 0;
}

module.exports = {
  validateLibraryEntryInput,
  listLibraryEntries,
  listLibraryTags,
  getLibraryEntryById,
  createLibraryEntry,
  createLibraryEntriesBulk,
  updateLibraryEntry,
  deleteLibraryEntry,
};
