function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hydrateRow(row) {
  if (!row) return null;
  const parsed = safeParseJson(row.result_json);
  const data = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    ...row,
    model: 'OpenAI',
    ...data,
    result: data,
    parsed: data,
  };
}

function getOwnedEssayQuestionContext(db, userId, essayId, questionId) {
  const uid = Number(userId);
  const eid = Number(essayId);
  const qid = Number(questionId);
  if (!uid || !eid || !qid) return null;

  return (
    db
      .prepare(`
        SELECT
          e.id AS essay_id,
          e.title AS essay_title,
          eq.id AS question_id,
          eq.question,
          eq.char_limit,
          eq.answer,
          a.memo AS application_memo,
          jp.title AS job_title,
          jp.position AS job_position,
          jp.memo AS job_memo,
          c.name AS company_name
        FROM essay_questions eq
        INNER JOIN essays e ON e.id = eq.essay_id
        LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
        LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
        LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
        WHERE e.id = ? AND e.user_id = ? AND eq.id = ?
      `)
      .get(eid, uid, qid) || null
  );
}

function saveEssayFeedback(db, userId, { essayId, questionId, model, result }) {
  const ctx = getOwnedEssayQuestionContext(db, userId, essayId, questionId);
  if (!ctx) return null;

  const info = db
    .prepare(`
      INSERT INTO essay_feedback (user_id, essay_id, question_id, model, result_json)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(Number(userId), ctx.essay_id, ctx.question_id, String(model), JSON.stringify(result));

  const row = db
    .prepare('SELECT * FROM essay_feedback WHERE id = ? AND user_id = ?')
    .get(Number(info.lastInsertRowid), Number(userId));
  return hydrateRow(row);
}

function getLatestEssayFeedback(db, userId, { essayId, questionId }) {
  const ctx = getOwnedEssayQuestionContext(db, userId, essayId, questionId);
  if (!ctx) return { owned: false, feedback: null };

  const row = db
    .prepare(`
      SELECT *
      FROM essay_feedback
      WHERE user_id = ? AND essay_id = ? AND question_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)
    .get(Number(userId), ctx.essay_id, ctx.question_id);

  return { owned: true, feedback: hydrateRow(row) };
}

function getOwnedMaterial(db, userId, materialId) {
  const uid = Number(userId);
  const mid = Number(materialId);
  if (!uid || !mid) return null;
  return (
    db
      .prepare('SELECT * FROM materials WHERE id = ? AND user_id = ?')
      .get(mid, uid) || null
  );
}

function saveMaterialStarDraft(db, userId, { materialId, model, result }) {
  const material = getOwnedMaterial(db, userId, materialId);
  if (!material) return null;

  const info = db
    .prepare(`
      INSERT INTO material_star_drafts (user_id, material_id, model, result_json)
      VALUES (?, ?, ?, ?)
    `)
    .run(Number(userId), material.id, String(model), JSON.stringify(result));

  const row = db
    .prepare('SELECT * FROM material_star_drafts WHERE id = ? AND user_id = ?')
    .get(Number(info.lastInsertRowid), Number(userId));
  return hydrateRow(row);
}

function getLatestMaterialStarDraft(db, userId, materialId) {
  const material = getOwnedMaterial(db, userId, materialId);
  if (!material) return { owned: false, draft: null };

  const row = db
    .prepare(`
      SELECT *
      FROM material_star_drafts
      WHERE user_id = ? AND material_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)
    .get(Number(userId), material.id);

  return { owned: true, draft: hydrateRow(row) };
}

function formatStarBlock(draftResult) {
  const lines = [
    `[STAR 초안 요약] ${draftResult.one_liner}`,
    `- 상황(S): ${draftResult.situation}`,
    `- 과제(T): ${draftResult.task}`,
    `- 행동(A): ${draftResult.action}`,
    `- 결과(R): ${draftResult.result}`,
  ];
  if (Array.isArray(draftResult.missing_info) && draftResult.missing_info.length > 0) {
    lines.push(`- 보완 필요 정보: ${draftResult.missing_info.join(' / ')}`);
  }
  return lines.join('\n');
}

function applyMaterialStarDraft(db, userId, { materialId, draftId }) {
  const uid = Number(userId);
  const material = getOwnedMaterial(db, uid, materialId);
  if (!material) return null;

  const did = Number(draftId);
  if (!did) return null;

  const draftRow = db
    .prepare('SELECT * FROM material_star_drafts WHERE id = ? AND user_id = ? AND material_id = ?')
    .get(did, uid, material.id);
  if (!draftRow) return null;

  const draft = hydrateRow(draftRow);
  if (!draft || !draft.result) return null;

  const block = formatStarBlock(draft.result);
  const currentContent = String(material.content || '').trim();
  const nextContent = currentContent ? `${currentContent}\n\n${block}` : block;

  db.prepare(`
    UPDATE materials
    SET content = ?,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(nextContent, material.id, uid);

  const updatedMaterial = getOwnedMaterial(db, uid, material.id);
  return { material: updatedMaterial, draft, appendedBlock: block };
}

module.exports = {
  getOwnedEssayQuestionContext,
  saveEssayFeedback,
  getLatestEssayFeedback,
  getOwnedMaterial,
  saveMaterialStarDraft,
  getLatestMaterialStarDraft,
  formatStarBlock,
  applyMaterialStarDraft,
};
