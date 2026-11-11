const { STAGE_LABELS, RESULT_LABELS, MATERIAL_KIND_LABELS } = require('../middleware/validation');

function escapeLike(str) {
  return String(str || '').replace(/[\\%_]/g, '\\$&');
}

function searchAll(db, userId, rawQuery, { limit = 5 } = {}) {
  const uid = Number(userId);
  const query = String(rawQuery || '').trim();
  const cap = Math.max(1, Math.min(50, Number(limit) || 5));

  if (!query) {
    return {
      query: '',
      companies: [],
      jobs: [],
      applications: [],
      essays: [],
      materials: [],
      total: 0,
    };
  }

  const pattern = `%${escapeLike(query)}%`;

  const companies = db
    .prepare(`
      SELECT id, name, industry, website, memo
      FROM companies
      WHERE user_id = ?
        AND (
          name LIKE ? ESCAPE '\\'
          OR industry LIKE ? ESCAPE '\\'
          OR memo LIKE ? ESCAPE '\\'
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `)
    .all(uid, pattern, pattern, pattern, cap)
    .map((c) => ({
      ...c,
      href: `/companies/${c.id}`,
    }));

  const jobs = db
    .prepare(`
      SELECT
        jp.id,
        jp.title,
        jp.position,
        jp.employment_type,
        jp.deadline,
        c.id AS company_id,
        c.name AS company_name
      FROM job_posts jp
      INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
      WHERE jp.user_id = ?
        AND (
          jp.title LIKE ? ESCAPE '\\'
          OR jp.position LIKE ? ESCAPE '\\'
          OR jp.memo LIKE ? ESCAPE '\\'
          OR c.name LIKE ? ESCAPE '\\'
        )
      ORDER BY jp.updated_at DESC, jp.id DESC
      LIMIT ?
    `)
    .all(uid, pattern, pattern, pattern, pattern, cap)
    .map((j) => ({
      ...j,
      href: `/jobs/${j.id}`,
    }));

  const applications = db
    .prepare(`
      SELECT
        a.id,
        a.stage,
        a.result,
        a.applied_at,
        a.memo,
        jp.id AS job_post_id,
        jp.title AS job_title,
        jp.position AS job_position,
        c.id AS company_id,
        c.name AS company_name
      FROM applications a
      INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
      INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
      WHERE a.user_id = ?
        AND (
          c.name LIKE ? ESCAPE '\\'
          OR jp.title LIKE ? ESCAPE '\\'
          OR jp.position LIKE ? ESCAPE '\\'
          OR a.memo LIKE ? ESCAPE '\\'
        )
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT ?
    `)
    .all(uid, pattern, pattern, pattern, pattern, cap)
    .map((a) => ({
      ...a,
      stage_label: STAGE_LABELS[a.stage] || a.stage,
      result_label: RESULT_LABELS[a.result] || a.result,
      href: `/applications/${a.id}`,
    }));

  const essays = db
    .prepare(`
      SELECT
        e.id,
        e.title,
        e.application_id,
        e.updated_at,
        c.name AS company_name,
        jp.title AS job_title
      FROM essays e
      LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
      LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
      LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
      WHERE e.user_id = ?
        AND (
          e.title LIKE ? ESCAPE '\\'
          OR c.name LIKE ? ESCAPE '\\'
          OR jp.title LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM essay_questions eq
            WHERE eq.essay_id = e.id
              AND (
                eq.question LIKE ? ESCAPE '\\'
                OR eq.answer LIKE ? ESCAPE '\\'
              )
          )
        )
      ORDER BY e.updated_at DESC, e.id DESC
      LIMIT ?
    `)
    .all(uid, pattern, pattern, pattern, pattern, pattern, cap)
    .map((e) => ({
      ...e,
      href: `/essays/${e.id}`,
    }));

  const materials = db
    .prepare(`
      SELECT id, kind, title, period, tags, updated_at
      FROM materials
      WHERE user_id = ?
        AND (
          title LIKE ? ESCAPE '\\'
          OR content LIKE ? ESCAPE '\\'
          OR tags LIKE ? ESCAPE '\\'
          OR period LIKE ? ESCAPE '\\'
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `)
    .all(uid, pattern, pattern, pattern, pattern, cap)
    .map((m) => ({
      ...m,
      kind_label: MATERIAL_KIND_LABELS[m.kind] || m.kind,
      href: `/materials/${m.id}`,
    }));

  const total =
    companies.length +
    jobs.length +
    applications.length +
    essays.length +
    materials.length;

  return {
    query,
    companies,
    jobs,
    applications,
    essays,
    materials,
    total,
  };
}

module.exports = {
  escapeLike,
  searchAll,
};
