// spec_watch (관심 자격증 구독) and external_cache (외부 API 응답 캐시).
// Re-exported by specsService, which is the public contract for other modules.

const { SpecValidationError, text } = require('./specsModel');

const WATCH_CODE_REGEX = /^[A-Za-z0-9_-]{1,40}$/;
const WATCH_NAME_MAX = 100;

function normalizeWatch(input = {}) {
  const code = text(input.cert_code !== undefined ? input.cert_code : input.certCode);
  const name = text(input.cert_name !== undefined ? input.cert_name : input.certName);
  if (!WATCH_CODE_REGEX.test(code)) throw new SpecValidationError('자격증 코드는 영문·숫자 40자 이하로 입력해 주세요.');
  if (!name || name.length > WATCH_NAME_MAX) throw new SpecValidationError(`자격증명을 ${WATCH_NAME_MAX}자 이하로 입력해 주세요.`);
  return { code, name };
}

// Accepts addWatch(db, uid, { cert_code, cert_name }) or addWatch(db, uid, code, name).
function addWatch(db, userId, input, certName) {
  const uid = Number(userId);
  const shaped = typeof input === 'object' && input !== null ? input : { cert_code: input, cert_name: certName };
  const { code, name } = normalizeWatch(shaped);
  const info = db
    .prepare('INSERT OR IGNORE INTO spec_watch (user_id, cert_code, cert_name) VALUES (?, ?, ?)')
    .run(uid, code, name);
  const watch = db.prepare('SELECT * FROM spec_watch WHERE user_id = ? AND cert_code = ?').get(uid, code);
  return { watch, duplicate: info.changes === 0 };
}

// Adapter shape expected by specSources/specsClient.addSpecWatch.
function createSpecWatch(db, userId, input) {
  return { duplicate: addWatch(db, userId, input).duplicate };
}

function removeWatch(db, userId, certCode) {
  return db
    .prepare('DELETE FROM spec_watch WHERE user_id = ? AND cert_code = ?')
    .run(Number(userId), text(certCode)).changes > 0;
}

function listWatches(db, userId) {
  return db
    .prepare('SELECT * FROM spec_watch WHERE user_id = ? ORDER BY created_at DESC, cert_code ASC')
    .all(Number(userId));
}

// external_cache.fetched_at is epoch milliseconds; expired or corrupt rows read as a miss.
function readExternalCache(db, source, queryHash, ttlMs) {
  const row = db
    .prepare('SELECT payload_json, fetched_at FROM external_cache WHERE source = ? AND query_hash = ?')
    .get(String(source), String(queryHash));
  if (!row) return null;
  if (Number.isFinite(ttlMs) && Date.now() - Number(row.fetched_at) >= ttlMs) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

function writeExternalCache(db, source, queryHash, payload) {
  db.prepare(`
    INSERT INTO external_cache (source, query_hash, payload_json, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(source, query_hash) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at
  `).run(String(source), String(queryHash), JSON.stringify(payload === undefined ? null : payload), Date.now());
}

module.exports = {
  addWatch,
  createSpecWatch,
  removeWatch,
  listWatches,
  readExternalCache,
  writeExternalCache,
};
