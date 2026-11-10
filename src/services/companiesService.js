function listCompanies(db, userId, { q = '' } = {}) {
  const keyword = String(q || '').trim();
  if (keyword) {
    const likeParam = `%${keyword}%`;
    return db
      .prepare(`
        SELECT
          c.*,
          COUNT(DISTINCT jp.id) AS job_count,
          COUNT(DISTINCT a.id) AS application_count
        FROM companies c
        LEFT JOIN job_posts jp ON jp.company_id = c.id AND jp.user_id = c.user_id
        LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = c.user_id
        WHERE c.user_id = ?
          AND (c.name LIKE ? OR c.industry LIKE ? OR c.memo LIKE ?)
        GROUP BY c.id
        ORDER BY c.name ASC, c.id DESC
      `)
      .all(userId, likeParam, likeParam, likeParam);
  }

  return db
    .prepare(`
      SELECT
        c.*,
        COUNT(DISTINCT jp.id) AS job_count,
        COUNT(DISTINCT a.id) AS application_count
      FROM companies c
      LEFT JOIN job_posts jp ON jp.company_id = c.id AND jp.user_id = c.user_id
      LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = c.user_id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.name ASC, c.id DESC
    `)
    .all(userId);
}

function getCompanyById(db, userId, id) {
  return (
    db
      .prepare('SELECT * FROM companies WHERE id = ? AND user_id = ?')
      .get(Number(id), userId) || null
  );
}

function getCompanyWithJobs(db, userId, id) {
  const company = getCompanyById(db, userId, id);
  if (!company) {
    return null;
  }
  const jobPosts = db
    .prepare(`
      SELECT
        jp.*,
        a.id AS application_id,
        a.stage AS application_stage,
        a.result AS application_result
      FROM job_posts jp
      LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
      WHERE jp.company_id = ? AND jp.user_id = ?
      ORDER BY jp.deadline IS NULL ASC, jp.deadline ASC, jp.id DESC
    `)
    .all(company.id, userId);

  return {
    ...company,
    jobPosts,
  };
}

function findCompanyByName(db, userId, name) {
  return (
    db
      .prepare('SELECT * FROM companies WHERE user_id = ? AND name = ?')
      .get(userId, String(name || '').trim()) || null
  );
}

function createCompany(db, userId, { name, industry = '', website = '', memo = '' }) {
  const info = db
    .prepare(`
      INSERT INTO companies (user_id, name, industry, website, memo)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      userId,
      String(name).trim(),
      String(industry || '').trim(),
      String(website || '').trim(),
      String(memo || '').trim()
    );

  return getCompanyById(db, userId, info.lastInsertRowid);
}

function updateCompany(db, userId, id, { name, industry = '', website = '', memo = '' }) {
  const existing = getCompanyById(db, userId, id);
  if (!existing) {
    return null;
  }

  db.prepare(`
    UPDATE companies
    SET name = ?,
        industry = ?,
        website = ?,
        memo = ?,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    String(name).trim(),
    String(industry || '').trim(),
    String(website || '').trim(),
    String(memo || '').trim(),
    existing.id,
    userId
  );

  return getCompanyById(db, userId, existing.id);
}

function deleteCompany(db, userId, id) {
  const info = db
    .prepare('DELETE FROM companies WHERE id = ? AND user_id = ?')
    .run(Number(id), userId);
  return info.changes > 0;
}

module.exports = {
  listCompanies,
  getCompanyById,
  getCompanyWithJobs,
  findCompanyByName,
  createCompany,
  updateCompany,
  deleteCompany,
};
