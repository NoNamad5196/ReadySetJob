const { diffWordsWithSpace } = require('diff');

const ESSAY_JOIN_SQL =
  'LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id ' +
  'LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id ' +
  'LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id';
const ESSAY_SELECT_COLS =
  'e.*, a.stage AS application_stage, a.result AS application_result, ' +
  'jp.id AS job_post_id, jp.title AS job_title, jp.position AS job_position, c.id AS company_id, c.name AS company_name';

const toNullableInt = (val) => (val !== null && val !== undefined && val !== '' ? Number(val) : null);
const parseSnapshotJson = (raw) => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } };
const buildSnapshotItems = (questions) =>
  questions.map((q) => ({ question_id: Number(q.id || q.question_id || 0) || null, question: String(q.question || ''), char_limit: toNullableInt(q.char_limit), answer: String(q.answer || '') }));

const listUserApplications = (db, userId) =>
  db.prepare(`SELECT a.id, a.stage, a.result, jp.title AS job_title, jp.position AS job_position, c.name AS company_name FROM applications a INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id WHERE a.user_id = ? ORDER BY a.updated_at DESC, a.id DESC`).all(userId);

const getOwnedApplication = (db, userId, applicationId) =>
  db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(Number(applicationId), userId) || null;

const getEssayHeader = (db, userId, essayId) =>
  db.prepare(`SELECT ${ESSAY_SELECT_COLS} FROM essays e ${ESSAY_JOIN_SQL} WHERE e.id = ? AND e.user_id = ?`).get(Number(essayId), userId) || null;

const getEssayQuestions = (db, essayId) =>
  db.prepare('SELECT id, essay_id, sort_order, question, char_limit, answer, updated_at FROM essay_questions WHERE essay_id = ? ORDER BY sort_order ASC, id ASC').all(Number(essayId));

function listEssays(db, userId, { q = '', application_id = null } = {}) {
  const keyword = String(q || '').trim();
  const conds = ['e.user_id = ?'];
  const params = [userId];
  if (application_id) { conds.push('e.application_id = ?'); params.push(Number(application_id)); }
  if (keyword) {
    const like = `%${keyword}%`;
    conds.push('(e.title LIKE ? OR c.name LIKE ? OR jp.title LIKE ? OR EXISTS (SELECT 1 FROM essay_questions eqs WHERE eqs.essay_id = e.id AND (eqs.question LIKE ? OR eqs.answer LIKE ?)))');
    params.push(like, like, like, like, like);
  }
  return db.prepare(`SELECT ${ESSAY_SELECT_COLS}, (SELECT COUNT(*) FROM essay_questions eq WHERE eq.essay_id = e.id) AS question_count, (SELECT MAX(ev.version_no) FROM essay_versions ev WHERE ev.essay_id = e.id) AS latest_version_no, (SELECT COUNT(*) FROM essay_versions ev WHERE ev.essay_id = e.id) AS version_count FROM essays e ${ESSAY_JOIN_SQL} WHERE ${conds.join(' AND ')} ORDER BY e.updated_at DESC, e.id DESC`).all(...params);
}

function listEssayVersions(db, userId, essayId) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  return db.prepare('SELECT ev.*, src.version_no AS restored_from_version_no FROM essay_versions ev LEFT JOIN essay_versions src ON src.id = ev.restored_from_version_id WHERE ev.essay_id = ? ORDER BY ev.version_no DESC, ev.id DESC').all(essay.id).map((row) => ({ ...row, snapshot: parseSnapshotJson(row.snapshot_json) }));
}

function getEssayById(db, userId, essayId) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const questions = getEssayQuestions(db, essay.id);
  const versions = listEssayVersions(db, userId, essay.id);
  const linkedMaterials = db.prepare('SELECT m.* FROM materials m INNER JOIN essay_materials em ON em.material_id = m.id WHERE em.essay_id = ? AND m.user_id = ? ORDER BY m.updated_at DESC, m.id DESC').all(essay.id, userId);
  const linkedIds = new Set(linkedMaterials.map((m) => m.id));
  const allMaterials = db.prepare('SELECT * FROM materials WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(userId).map((m) => ({ ...m, is_linked: linkedIds.has(m.id) }));
  return { ...essay, questions, versions, latest_version_no: versions.length > 0 ? versions[0].version_no : null, linkedMaterials, allMaterials };
}

function createEssay(db, userId, { title, application_id = null, questions = [] }) {
  const essayId = db.transaction(() => {
    const info = db.prepare('INSERT INTO essays (user_id, application_id, title) VALUES (?, ?, ?)').run(userId, toNullableInt(application_id), String(title).trim());
    const newId = Number(info.lastInsertRowid);
    const insertQ = db.prepare('INSERT INTO essay_questions (essay_id, sort_order, question, char_limit, answer) VALUES (?, ?, ?, ?, ?)');
    questions.forEach((q, idx) => insertQ.run(newId, idx + 1, String(q.question).trim(), toNullableInt(q.char_limit), String(q.answer || '')));
    return newId;
  })();
  return getEssayById(db, userId, essayId);
}

function saveEssayDraft(db, userId, { essayId, title, application_id, answers = [] }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  return db.transaction(() => {
    if (title !== undefined && String(title).trim()) {
      const nextAppId = application_id === undefined ? essay.application_id : toNullableInt(application_id);
      db.prepare("UPDATE essays SET title = ?, application_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(String(title).trim(), nextAppId, essay.id, userId);
    } else {
      db.prepare("UPDATE essays SET updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(essay.id, userId);
    }
    const updateAns = db.prepare("UPDATE essay_questions SET answer = ?, updated_at = datetime('now') WHERE id = ? AND essay_id = ?");
    for (const item of answers) {
      const qid = Number(item.question_id || item.id);
      if (qid) updateAns.run(String(item.answer ?? ''), qid, essay.id);
    }
    const updated = db.prepare('SELECT updated_at FROM essays WHERE id = ? AND user_id = ?').get(essay.id, userId);
    return { essay_id: essay.id, saved_at: updated.updated_at };
  })();
}

function addEssayQuestion(db, userId, { essayId, question, char_limit = null, answer = '' }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  return db.transaction(() => {
    const maxRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM essay_questions WHERE essay_id = ?').get(essay.id);
    const info = db.prepare('INSERT INTO essay_questions (essay_id, sort_order, question, char_limit, answer) VALUES (?, ?, ?, ?, ?)').run(essay.id, Number(maxRow.max_order) + 1, String(question).trim(), toNullableInt(char_limit), String(answer || ''));
    db.prepare("UPDATE essays SET updated_at = datetime('now') WHERE id = ?").run(essay.id);
    return db.prepare('SELECT * FROM essay_questions WHERE id = ?').get(Number(info.lastInsertRowid));
  })();
}

function updateEssayQuestion(db, userId, { essayId, questionId, question, char_limit = null }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const existing = db.prepare('SELECT * FROM essay_questions WHERE id = ? AND essay_id = ?').get(Number(questionId), essay.id);
  if (!existing) return null;
  db.prepare("UPDATE essay_questions SET question = ?, char_limit = ?, updated_at = datetime('now') WHERE id = ? AND essay_id = ?").run(String(question).trim(), toNullableInt(char_limit), existing.id, essay.id);
  db.prepare("UPDATE essays SET updated_at = datetime('now') WHERE id = ?").run(essay.id);
  return db.prepare('SELECT * FROM essay_questions WHERE id = ?').get(existing.id);
}

function deleteEssayQuestion(db, userId, { essayId, questionId }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const questions = getEssayQuestions(db, essay.id);
  const target = questions.find((q) => q.id === Number(questionId));
  if (!target) return null;
  if (questions.length <= 1) return { error: 'MIN_ONE_QUESTION' };
  db.transaction(() => {
    db.prepare('DELETE FROM essay_questions WHERE id = ? AND essay_id = ?').run(target.id, essay.id);
    const renum = db.prepare('UPDATE essay_questions SET sort_order = ? WHERE id = ?');
    getEssayQuestions(db, essay.id).forEach((q, idx) => renum.run(idx + 1, q.id));
    db.prepare("UPDATE essays SET updated_at = datetime('now') WHERE id = ?").run(essay.id);
  })();
  return { deleted: true };
}

function moveEssayQuestion(db, userId, { essayId, questionId, dir }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const questions = getEssayQuestions(db, essay.id);
  const idx = questions.findIndex((q) => q.id === Number(questionId));
  if (idx === -1) return null;
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= questions.length) return questions;
  db.transaction(() => {
    [questions[idx], questions[swapIdx]] = [questions[swapIdx], questions[idx]];
    const renum = db.prepare('UPDATE essay_questions SET sort_order = ? WHERE id = ?');
    questions.forEach((q, i) => renum.run(i + 1, q.id));
    db.prepare("UPDATE essays SET updated_at = datetime('now') WHERE id = ?").run(essay.id);
  })();
  return getEssayQuestions(db, essay.id);
}

function insertVersionSnapshot(db, { essayId, label = '', snapshotItems, restoredFromVersionId = null }) {
  const maxRow = db.prepare('SELECT COALESCE(MAX(version_no), 0) AS max_no FROM essay_versions WHERE essay_id = ?').get(essayId);
  const info = db.prepare('INSERT INTO essay_versions (essay_id, version_no, label, snapshot_json, restored_from_version_id) VALUES (?, ?, ?, ?, ?)').run(essayId, Number(maxRow.max_no) + 1, String(label || '').trim(), JSON.stringify(snapshotItems), restoredFromVersionId);
  db.prepare("UPDATE essays SET updated_at = datetime('now') WHERE id = ?").run(essayId);
  return db.prepare('SELECT * FROM essay_versions WHERE id = ?').get(Number(info.lastInsertRowid));
}

function createEssayVersion(db, userId, { essayId, label = '' }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const snapshotItems = buildSnapshotItems(getEssayQuestions(db, essay.id));
  const created = db.transaction(() => insertVersionSnapshot(db, { essayId: essay.id, label: String(label || '').trim() || '버전 스냅샷', snapshotItems, restoredFromVersionId: null }))();
  return { ...created, snapshot: parseSnapshotJson(created.snapshot_json) };
}

function getEssayVersion(db, userId, { essayId, versionNo }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const row = db.prepare('SELECT ev.*, src.version_no AS restored_from_version_no FROM essay_versions ev LEFT JOIN essay_versions src ON src.id = ev.restored_from_version_id WHERE ev.essay_id = ? AND ev.version_no = ?').get(essay.id, Number(versionNo));
  return row ? { ...row, snapshot: parseSnapshotJson(row.snapshot_json) } : null;
}

const draftsDiffer = (cur, snap) =>
  !snap || cur.length !== snap.length || cur.some((c, i) => c.question !== snap[i].question || (c.char_limit ?? null) !== (snap[i].char_limit ?? null) || c.answer !== snap[i].answer);

function restoreEssayVersion(db, userId, { essayId, versionNo }) {
  const essay = getEssayHeader(db, userId, essayId);
  if (!essay) return null;
  const targetVersion = getEssayVersion(db, userId, { essayId: essay.id, versionNo });
  if (!targetVersion) return null;

  return db.transaction(() => {
    const currentQuestions = getEssayQuestions(db, essay.id);
    const currentItems = buildSnapshotItems(currentQuestions);
    const latestRow = db.prepare('SELECT * FROM essay_versions WHERE essay_id = ? ORDER BY version_no DESC LIMIT 1').get(essay.id);
    const latestSnapshot = latestRow ? parseSnapshotJson(latestRow.snapshot_json) : null;
    const backupVersion = !latestRow || draftsDiffer(currentItems, latestSnapshot)
      ? insertVersionSnapshot(db, { essayId: essay.id, label: '복원 전 자동 저장', snapshotItems: currentItems, restoredFromVersionId: null })
      : null;

    const existingIds = new Set(currentQuestions.map((q) => q.id));
    const targetIds = new Set(targetVersion.snapshot.map((s) => Number(s.question_id)).filter((id) => existingIds.has(id)));
    currentQuestions.filter((q) => !targetIds.has(q.id)).forEach((q) => db.prepare('DELETE FROM essay_questions WHERE id = ? AND essay_id = ?').run(q.id, essay.id));

    const updateQ = db.prepare("UPDATE essay_questions SET sort_order = ?, question = ?, char_limit = ?, answer = ?, updated_at = datetime('now') WHERE id = ? AND essay_id = ?");
    const insertQ = db.prepare('INSERT INTO essay_questions (essay_id, sort_order, question, char_limit, answer) VALUES (?, ?, ?, ?, ?)');
    targetVersion.snapshot.forEach((item, idx) => {
      const qid = Number(item.question_id);
      const limit = toNullableInt(item.char_limit);
      if (qid && targetIds.has(qid)) updateQ.run(idx + 1, String(item.question || ''), limit, String(item.answer || ''), qid, essay.id);
      else insertQ.run(essay.id, idx + 1, String(item.question || ''), limit, String(item.answer || ''));
    });

    const restoredVersion = insertVersionSnapshot(db, { essayId: essay.id, label: `v${targetVersion.version_no}에서 복원`, snapshotItems: buildSnapshotItems(getEssayQuestions(db, essay.id)), restoredFromVersionId: targetVersion.id });
    return { backupVersion, restoredVersion };
  })();
}

function compareEssayVersions(db, userId, { essayId, from, to }) {
  const essay = getEssayHeader(db, userId, essayId);
  const fromVersion = essay ? getEssayVersion(db, userId, { essayId: essay.id, versionNo: from }) : null;
  if (!fromVersion) return null;

  const isCurrent = String(to) === 'current';
  const toVersion = isCurrent ? null : getEssayVersion(db, userId, { essayId: essay.id, versionNo: to });
  if (!isCurrent && !toVersion) return null;
  const toLabel = isCurrent ? '현재 초안' : `v${toVersion.version_no}${toVersion.label ? ` (${toVersion.label})` : ''}`;
  const toItems = isCurrent ? buildSnapshotItems(getEssayQuestions(db, essay.id)) : toVersion.snapshot;
  const fromItems = fromVersion.snapshot;

  const matchedTo = new Set();
  const matchedFrom = new Set();
  const pairs = [];
  fromItems.forEach((fItem, fIdx) => {
    const tIdx = fItem.question_id ? toItems.findIndex((tItem, idx) => !matchedTo.has(idx) && tItem.question_id === fItem.question_id) : -1;
    if (tIdx !== -1) { matchedFrom.add(fIdx); matchedTo.add(tIdx); pairs.push({ order: fIdx, fromItem: fItem, toItem: toItems[tIdx], status: 'matched' }); }
  });
  for (let i = 0; i < Math.max(fromItems.length, toItems.length); i += 1) {
    const fUn = i < fromItems.length && !matchedFrom.has(i);
    const tUn = i < toItems.length && !matchedTo.has(i);
    if (fUn && tUn) pairs.push({ order: i, fromItem: fromItems[i], toItem: toItems[i], status: 'matched' });
    else if (fUn) pairs.push({ order: i, fromItem: fromItems[i], toItem: null, status: 'removed' });
    else if (tUn) pairs.push({ order: i + 0.5, fromItem: null, toItem: toItems[i], status: 'added' });
  }
  pairs.sort((a, b) => a.order - b.order);

  const diffs = pairs.map((p, idx) => {
    const fAns = String(p.fromItem?.answer || '');
    const tAns = String(p.toItem?.answer || '');
    if (p.status === 'removed') return { index: idx + 1, status: 'removed', question: p.fromItem.question, char_limit: p.fromItem.char_limit, fromLen: fAns.length, toLen: 0, parts: [{ value: fAns, removed: true, added: false }] };
    if (p.status === 'added') return { index: idx + 1, status: 'added', question: p.toItem.question, char_limit: p.toItem.char_limit, fromLen: 0, toLen: tAns.length, parts: [{ value: tAns, added: true, removed: false }] };
    return { index: idx + 1, status: 'matched', question: p.toItem.question || p.fromItem.question, fromQuestion: p.fromItem.question, toQuestion: p.toItem.question, char_limit: p.toItem.char_limit ?? p.fromItem.char_limit, fromLen: fAns.length, toLen: tAns.length, parts: diffWordsWithSpace(fAns, tAns) };
  });

  const fromLabel = `v${fromVersion.version_no}${fromVersion.label ? ` (${fromVersion.label})` : ''}`;
  return { essay, fromVersion, toVersion, fromLabel, toLabel, fromParam: String(fromVersion.version_no), toParam: String(to), diffs };
}

function searchEssayQuestions(db, userId, { q = '', excludeEssayId = null } = {}) {
  const keyword = String(q || '').trim();
  const conds = ['e.user_id = ?'];
  const params = [userId];
  if (excludeEssayId) { conds.push('e.id != ?'); params.push(Number(excludeEssayId)); }
  if (keyword) { const like = `%${keyword}%`; conds.push('(e.title LIKE ? OR eq.question LIKE ? OR eq.answer LIKE ? OR c.name LIKE ?)'); params.push(like, like, like, like); }
  return db.prepare(`SELECT eq.id AS question_id, eq.essay_id, eq.sort_order, eq.question, eq.char_limit, eq.answer, eq.updated_at, e.title AS essay_title, c.name AS company_name, jp.title AS job_title FROM essay_questions eq INNER JOIN essays e ON e.id = eq.essay_id ${ESSAY_JOIN_SQL} WHERE ${conds.join(' AND ')} ORDER BY eq.updated_at DESC, eq.id DESC LIMIT 30`).all(...params);
}

function createMaterial(db, userId, { kind = 'experience', title, period = '', content = '', tags = '' }) {
  const info = db.prepare('INSERT INTO materials (user_id, kind, title, period, content, tags) VALUES (?, ?, ?, ?, ?, ?)').run(userId, kind, String(title).trim(), String(period), String(content), String(tags));
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(info.lastInsertRowid));
}

function linkMaterialToEssay(db, userId, { essayId, materialId }) {
  const essay = getEssayHeader(db, userId, essayId);
  const material = db.prepare('SELECT * FROM materials WHERE id = ? AND user_id = ?').get(Number(materialId), userId);
  if (!essay || !material) return null;
  db.prepare('INSERT OR IGNORE INTO essay_materials (essay_id, material_id) VALUES (?, ?)').run(essay.id, material.id);
  return { essay_id: essay.id, material_id: material.id };
}

function unlinkMaterialFromEssay(db, userId, { essayId, materialId }) {
  const essay = getEssayHeader(db, userId, essayId);
  const material = db.prepare('SELECT * FROM materials WHERE id = ? AND user_id = ?').get(Number(materialId), userId);
  if (!essay || !material) return null;
  db.prepare('DELETE FROM essay_materials WHERE essay_id = ? AND material_id = ?').run(essay.id, material.id);
  return { essay_id: essay.id, material_id: material.id };
}

const deleteEssay = (db, userId, essayId) => db.prepare('DELETE FROM essays WHERE id = ? AND user_id = ?').run(Number(essayId), userId).changes > 0;

module.exports = {
  listUserApplications, getOwnedApplication, listEssays, getEssayById, createEssay, saveEssayDraft,
  addEssayQuestion, updateEssayQuestion, deleteEssayQuestion, moveEssayQuestion,
  createEssayVersion, listEssayVersions, getEssayVersion, restoreEssayVersion, compareEssayVersions,
  searchEssayQuestions, createMaterial, linkMaterialToEssay, unlinkMaterialFromEssay, deleteEssay,
};
