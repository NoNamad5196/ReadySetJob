const { normalizeTags } = require('../middleware/validation');
const { getLatestMaterialStarDraft } = require('./aiFeaturesService');

function buildFilterClause(userId, { kind = '', q = '' } = {}) {
  const conditions = ['m.user_id = ?'];
  const params = [Number(userId)];

  if (kind && kind !== 'all') {
    conditions.push('m.kind = ?');
    params.push(kind);
  }

  const keyword = String(q || '').trim();
  if (keyword) {
    conditions.push('(m.title LIKE ? OR m.content LIKE ? OR m.tags LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  return { whereSql: conditions.join(' AND '), params };
}

function listMaterials(db, userId, filters = {}) {
  const { whereSql, params } = buildFilterClause(userId, filters);
  const sql = `
    SELECT
      m.*,
      (SELECT COUNT(*) FROM essay_materials em
       INNER JOIN essays e ON e.id = em.essay_id
       WHERE em.material_id = m.id AND e.user_id = m.user_id) AS linked_essay_count
    FROM materials m
    WHERE ${whereSql}
    ORDER BY m.updated_at DESC, m.id DESC
  `;
  return db.prepare(sql).all(...params);
}

function getMaterialById(db, userId, id) {
  return (
    db
      .prepare('SELECT * FROM materials WHERE id = ? AND user_id = ?')
      .get(Number(id), Number(userId)) || null
  );
}

function getMaterialWithEssays(db, userId, id) {
  const material = getMaterialById(db, userId, id);
  if (!material) return null;

  const linkedEssays = db
    .prepare(`
      SELECT
        e.id,
        e.title,
        e.application_id,
        e.updated_at,
        jp.title AS job_title,
        c.name AS company_name
      FROM essays e
      INNER JOIN essay_materials em ON em.essay_id = e.id
      LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
      LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
      LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
      WHERE em.material_id = ? AND e.user_id = ?
      ORDER BY e.updated_at DESC, e.id DESC
    `)
    .all(material.id, Number(userId));

  const { draft: latestStarDraft } = getLatestMaterialStarDraft(db, userId, material.id);

  return { ...material, linkedEssays, latestStarDraft };
}

function createMaterial(
  db,
  userId,
  { kind = 'experience', title, period = '', content = '', tags = '' }
) {
  const uid = Number(userId);
  const normalizedTags = normalizeTags(tags);
  const info = db
    .prepare(`
      INSERT INTO materials (user_id, kind, title, period, content, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      uid,
      kind,
      String(title).trim(),
      String(period || '').trim(),
      String(content || '').trim(),
      normalizedTags
    );

  return getMaterialById(db, uid, info.lastInsertRowid);
}

function updateMaterial(
  db,
  userId,
  id,
  { kind = 'experience', title, period = '', content = '', tags = '' }
) {
  const uid = Number(userId);
  const existing = getMaterialById(db, uid, id);
  if (!existing) return null;

  const normalizedTags = normalizeTags(tags);
  db.prepare(`
    UPDATE materials
    SET kind = ?,
        title = ?,
        period = ?,
        content = ?,
        tags = ?,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    kind,
    String(title).trim(),
    String(period || '').trim(),
    String(content || '').trim(),
    normalizedTags,
    existing.id,
    uid
  );

  return getMaterialById(db, uid, existing.id);
}

function deleteMaterial(db, userId, id) {
  const uid = Number(userId);
  const info = db
    .prepare('DELETE FROM materials WHERE id = ? AND user_id = ?')
    .run(Number(id), uid);
  return info.changes > 0;
}

module.exports = {
  listMaterials,
  getMaterialById,
  getMaterialWithEssays,
  createMaterial,
  updateMaterial,
  deleteMaterial,
};
