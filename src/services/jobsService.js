const { getCompanyById, findCompanyByName, createCompany } = require('./companiesService');

function listJobPosts(
  db,
  userId,
  { q = '', employment_type = '', bookmarked = '', sort = 'deadline' } = {}
) {
  const conditions = ['jp.user_id = ?'];
  const params = [userId];

  const keyword = String(q || '').trim();
  if (keyword) {
    conditions.push('(jp.title LIKE ? OR jp.position LIKE ? OR c.name LIKE ?)');
    const likeParam = `%${keyword}%`;
    params.push(likeParam, likeParam, likeParam);
  }

  const empTypes = (Array.isArray(employment_type) ? employment_type : String(employment_type || '').split(','))
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (empTypes.length === 1) {
    conditions.push('jp.employment_type = ?');
    params.push(empTypes[0]);
  } else if (empTypes.length > 1) {
    conditions.push(`jp.employment_type IN (${empTypes.map(() => '?').join(', ')})`);
    params.push(...empTypes);
  }

  if (String(bookmarked) === '1') {
    conditions.push('jp.is_bookmarked = 1');
  }

  const orderBy =
    sort === 'recent'
      ? 'jp.created_at DESC, jp.id DESC'
      : 'jp.deadline IS NULL ASC, jp.deadline ASC, jp.id DESC';

  const sql = `
    SELECT
      jp.*,
      c.name AS company_name,
      c.industry AS company_industry,
      a.id AS application_id,
      a.stage AS application_stage,
      a.result AS application_result
    FROM job_posts jp
    INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
    LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
  `;

  return db.prepare(sql).all(...params);
}

function getJobPostById(db, userId, id) {
  return (
    db
      .prepare(`
        SELECT
          jp.*,
          c.name AS company_name,
          c.industry AS company_industry,
          c.website AS company_website,
          a.id AS application_id,
          a.stage AS application_stage,
          a.result AS application_result,
          a.applied_at AS application_applied_at
        FROM job_posts jp
        INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
        LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
        WHERE jp.id = ? AND jp.user_id = ?
      `)
      .get(Number(id), userId) || null
  );
}

function createJobPostWithCompany(
  db,
  userId,
  {
    company_id,
    new_company_name = '',
    new_company_industry = '',
    new_company_website = '',
    title,
    position = '',
    employment_type = 'new_grad',
    url = '',
    deadline = null,
    memo = '',
    is_bookmarked = 0,
  }
) {
  const tx = db.transaction(() => {
    let targetCompanyId = null;
    const trimmedNewCompany = String(new_company_name || '').trim();

    if (trimmedNewCompany) {
      const existingCompany = findCompanyByName(db, userId, trimmedNewCompany);
      if (existingCompany) {
        targetCompanyId = existingCompany.id;
      } else {
        const createdCompany = createCompany(db, userId, {
          name: trimmedNewCompany,
          industry: new_company_industry,
          website: new_company_website,
        });
        targetCompanyId = createdCompany.id;
      }
    } else {
      const existingCompany = getCompanyById(db, userId, company_id);
      if (!existingCompany) {
        const err = new Error('선택한 기업을 찾을 수 없습니다.');
        err.code = 'COMPANY_NOT_FOUND';
        throw err;
      }
      targetCompanyId = existingCompany.id;
    }

    const info = db
      .prepare(`
        INSERT INTO job_posts (
          user_id, company_id, title, position, employment_type, url, deadline, memo, is_bookmarked
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        userId,
        targetCompanyId,
        String(title).trim(),
        String(position || '').trim(),
        employment_type,
        String(url || '').trim(),
        deadline && String(deadline).trim() ? String(deadline).trim() : null,
        String(memo || '').trim(),
        is_bookmarked ? 1 : 0
      );

    return getJobPostById(db, userId, info.lastInsertRowid);
  });

  return tx();
}

function updateJobPost(
  db,
  userId,
  id,
  {
    company_id,
    title,
    position = '',
    employment_type = 'new_grad',
    url = '',
    deadline = null,
    memo = '',
    is_bookmarked,
  }
) {
  const existing = getJobPostById(db, userId, id);
  if (!existing) {
    return null;
  }

  const company = getCompanyById(db, userId, company_id);
  if (!company) {
    const err = new Error('선택한 기업을 찾을 수 없습니다.');
    err.code = 'COMPANY_NOT_FOUND';
    throw err;
  }

  const bookmarkedVal =
    is_bookmarked === undefined ? existing.is_bookmarked : is_bookmarked ? 1 : 0;

  db.prepare(`
    UPDATE job_posts
    SET company_id = ?,
        title = ?,
        position = ?,
        employment_type = ?,
        url = ?,
        deadline = ?,
        memo = ?,
        is_bookmarked = ?,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    company.id,
    String(title).trim(),
    String(position || '').trim(),
    employment_type,
    String(url || '').trim(),
    deadline && String(deadline).trim() ? String(deadline).trim() : null,
    String(memo || '').trim(),
    bookmarkedVal,
    existing.id,
    userId
  );

  return getJobPostById(db, userId, existing.id);
}

function toggleJobBookmark(db, userId, id) {
  const existing = getJobPostById(db, userId, id);
  if (!existing) {
    return null;
  }
  const nextVal = existing.is_bookmarked === 1 ? 0 : 1;
  db.prepare(`
    UPDATE job_posts
    SET is_bookmarked = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(nextVal, existing.id, userId);

  return getJobPostById(db, userId, existing.id);
}

function deleteJobPost(db, userId, id) {
  const info = db
    .prepare('DELETE FROM job_posts WHERE id = ? AND user_id = ?')
    .run(Number(id), userId);
  return info.changes > 0;
}

module.exports = {
  listJobPosts,
  getJobPostById,
  createJobPostWithCompany,
  updateJobPost,
  toggleJobBookmark,
  deleteJobPost,
};
