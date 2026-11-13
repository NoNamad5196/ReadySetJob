const bcrypt = require('bcryptjs');

const MAX_AVATAR_BYTES = 200 * 1024;
const AVATAR_DATA_URL_REGEX = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i;
const BASE64_FORMAT_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function findByEmail(db, email) {
  const normalized = String(email || '').trim().toLowerCase();
  return db
    .prepare('SELECT id, email, password_hash, name, season_label, avatar_data, created_at FROM users WHERE lower(email) = ?')
    .get(normalized);
}

function findById(db, id) {
  return db
    .prepare('SELECT id, email, name, season_label, auto_feedback, avatar_data, created_at FROM users WHERE id = ?')
    .get(Number(id));
}


function createUser(db, { email, password, name, season_label = null }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const trimmedName = String(name).trim();
  const trimmedSeason = season_label && String(season_label).trim() ? String(season_label).trim() : null;
  const passwordHash = bcrypt.hashSync(password, 10);

  const info = db
    .prepare('INSERT INTO users (email, password_hash, name, season_label) VALUES (?, ?, ?, ?)')
    .run(normalizedEmail, passwordHash, trimmedName, trimmedSeason);

  return findById(db, info.lastInsertRowid);
}

function verifyUserCredentials(db, { email, password }) {
  const user = findByEmail(db, email);
  if (!user) {
    return null;
  }
  const ok = bcrypt.compareSync(String(password || ''), user.password_hash);
  if (!ok) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    season_label: user.season_label || null,
  };
}

function getCurrentYearMonth(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getMonthlyGoalProgress(db, userId, monthStr = getCurrentYearMonth()) {
  const uid = Number(userId);
  const ym = String(monthStr || getCurrentYearMonth()).trim();
  const goalRow = db
    .prepare('SELECT month, target FROM monthly_goals WHERE user_id = ? AND month = ?')
    .get(uid, ym);
  const currentRow = db
    .prepare(`
      SELECT COUNT(*) AS cnt
      FROM applications
      WHERE user_id = ?
        AND strftime('%Y-%m', COALESCE(applied_at, created_at)) = ?
    `)
    .get(uid, ym);

  const monthNum = Number(ym.split('-')[1]) || new Date().getMonth() + 1;
  return {
    month: ym,
    label: `${monthNum}월`,
    target: goalRow ? Number(goalRow.target) : null,
    current: currentRow ? Number(currentRow.cnt) || 0 : 0,
  };
}

function upsertMonthlyGoal(db, userId, { month = getCurrentYearMonth(), target }) {
  const uid = Number(userId);
  const ym = String(month || getCurrentYearMonth()).trim();
  if (target === null || target === undefined || String(target).trim() === '') {
    db.prepare('DELETE FROM monthly_goals WHERE user_id = ? AND month = ?').run(uid, ym);
    return getMonthlyGoalProgress(db, uid, ym);
  }

  const num = Number(target);
  if (typeof target === 'boolean' || !Number.isInteger(num) || num < 1 || num > 200) {
    const err = new Error('이번 달 지원 목표는 1 이상 200 이하의 정수로 입력해 주세요.');
    err.status = 422;
    err.expose = true;
    throw err;
  }

  db.prepare(`
    INSERT INTO monthly_goals (user_id, month, target)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, month) DO UPDATE SET target = excluded.target
  `).run(uid, ym, num);

  return getMonthlyGoalProgress(db, uid, ym);
}

function updateUserSettings(db, userId, { name, season_label, target, month = getCurrentYearMonth(), auto_feedback }) {
  const uid = Number(userId);
  return db.transaction(() => {
    const existing = findById(db, uid);
    if (!existing) return null;

    const trimmedName = name !== undefined ? String(name).trim() : existing.name;
    if (!trimmedName || trimmedName.length > 60) {
      const err = new Error('이름을 1자 이상 60자 이하로 입력해 주세요.');
      err.status = 422;
      err.expose = true;
      throw err;
    }

    const rawSeason = season_label !== undefined ? String(season_label).trim() : (existing.season_label || '');
    if (rawSeason.length > 80) {
      const err = new Error('시즌 라벨은 80자 이하로 입력해 주세요.');
      err.status = 422;
      err.expose = true;
      throw err;
    }
    const nextSeason = rawSeason ? rawSeason : null;

    const nextAutoFeedback = auto_feedback !== undefined
      ? (auto_feedback === 1 || auto_feedback === true || ['1', 'on', 'true'].includes(String(auto_feedback).toLowerCase()) ? 1 : 0)
      : Number(existing.auto_feedback) === 1 ? 1 : 0;

    db.prepare('UPDATE users SET name = ?, season_label = ?, auto_feedback = ? WHERE id = ?').run(
      trimmedName,
      nextSeason,
      nextAutoFeedback,
      uid
    );

    const goal = target !== undefined
      ? upsertMonthlyGoal(db, uid, { month, target })
      : getMonthlyGoalProgress(db, uid, month);

    return {
      user: findById(db, uid),
      goal,
    };
  })();
}

function validateAvatarDataUrl(raw) {
  if (typeof raw !== 'string') {
    return { error: '유효한 이미지 데이터(PNG, JPEG, WebP)를 선택해 주세요.' };
  }
  const trimmed = raw.trim().replace(/[\r\n\s]+/g, '');
  const match = trimmed.match(AVATAR_DATA_URL_REGEX);
  if (!match) {
    return { error: 'PNG, JPEG, WebP 형식의 이미지(base64 Data URL)만 업로드할 수 있습니다.' };
  }

  const mimeSubtype = match[1].toLowerCase();
  const base64Payload = match[2];
  if (!base64Payload || base64Payload.length % 4 !== 0 || !BASE64_FORMAT_REGEX.test(base64Payload)) {
    return { error: '유효하지 않은 base64 이미지 데이터입니다.' };
  }

  const decoded = Buffer.from(base64Payload, 'base64');
  if (decoded.length === 0) {
    return { error: '비어 있는 이미지는 업로드할 수 없습니다.' };
  }
  if (decoded.length > MAX_AVATAR_BYTES) {
    return { error: '프로필 사진은 디코딩 기준 200KB 이하만 업로드할 수 있습니다.' };
  }

  const headText = decoded.subarray(0, 256).toString('utf8').toLowerCase();
  if (headText.includes('<svg') || headText.includes('<?xml') || headText.includes('<html')) {
    return { error: 'SVG 또는 허용되지 않는 파일 형식은 업로드할 수 없습니다.' };
  }

  return {
    value: `data:image/${mimeSubtype};base64,${base64Payload}`,
    byteLength: decoded.length,
  };
}

function updateUserAvatar(db, userId, avatarDataUrl) {
  const uid = Number(userId);
  const existing = findById(db, uid);
  if (!existing) return null;

  if (avatarDataUrl === null || avatarDataUrl === '') {
    db.prepare('UPDATE users SET avatar_data = NULL WHERE id = ?').run(uid);
    return findById(db, uid);
  }

  const parsed = validateAvatarDataUrl(avatarDataUrl);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.status = 422;
    err.expose = true;
    throw err;
  }

  db.prepare('UPDATE users SET avatar_data = ? WHERE id = ?').run(parsed.value, uid);
  return findById(db, uid);
}

function removeUserAvatar(db, userId) {
  const uid = Number(userId);
  const existing = findById(db, uid);
  if (!existing) return null;
  db.prepare('UPDATE users SET avatar_data = NULL WHERE id = ?').run(uid);
  return findById(db, uid);
}


function getDashboardCounts(db, userId) {
  const companiesCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM companies WHERE user_id = ?')
    .get(userId).cnt;
  const jobsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM job_posts WHERE user_id = ?')
    .get(userId).cnt;
  const bookmarkedJobsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM job_posts WHERE user_id = ? AND is_bookmarked = 1')
    .get(userId).cnt;
  const applicationsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM applications WHERE user_id = ?')
    .get(userId).cnt;
  const inProgressCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM applications WHERE user_id = ? AND result = 'in_progress'")
    .get(userId).cnt;
  const passedCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM applications WHERE user_id = ? AND result = 'passed'")
    .get(userId).cnt;
  const upcomingEventsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM events WHERE user_id = ?')
    .get(userId).cnt;

  return {
    companiesCount,
    jobsCount,
    bookmarkedJobsCount,
    applicationsCount,
    inProgressCount,
    passedCount,
    upcomingEventsCount,
  };
}

module.exports = {
  MAX_AVATAR_BYTES,
  findByEmail,
  findById,
  createUser,
  verifyUserCredentials,
  getDashboardCounts,
  getCurrentYearMonth,
  getMonthlyGoalProgress,
  upsertMonthlyGoal,
  updateUserSettings,
  validateAvatarDataUrl,
  updateUserAvatar,
  removeUserAvatar,
};

