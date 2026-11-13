// 스펙 관리 core service. Public contract (also used by specSources/*):
//   createSpecItem(db, userId, payload) → item (+ duplicate: boolean, automation)
//   getSpecItem / listSpecItems / updateSpecItem / updateSpecStatus / deleteSpecItem
//   addWatch / removeWatch / listWatches, readExternalCache / writeExternalCache
// Validation failures throw SpecValidationError (status 422). Every query is user-scoped.
// Model/validation lives in specsModel.js, watch+cache in specWatchService.js; both re-exported.

const { isValidDate, calculateDday } = require('../middleware/validation');
const { getMaterialById } = require('./materialsService');
const {
  ACTIVE_STATUSES,
  localDateString,
  scheduleSlots,
  syncSpecSchedule,
  removeSpecSchedule,
  applySpecStatusAutomation,
} = require('./specAutomationService');
const model = require('./specsModel');
const watchService = require('./specWatchService');

const { SPEC_KINDS, SPEC_STATUSES, DATE_FIELDS, KIND_LABELS, BOARD_COLUMNS, SpecValidationError, text, decorate, validateSpecPayload } = model;

function getRawSpecItem(db, userId, id) {
  return db.prepare('SELECT * FROM spec_items WHERE id = ? AND user_id = ?').get(Number(id), Number(userId)) || null;
}

function getSpecItem(db, userId, id) {
  return decorate(getRawSpecItem(db, userId, id));
}

function isUniqueViolation(err) {
  return err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT') && /UNIQUE/.test(err.message);
}

function createSpecItem(db, userId, payload) {
  const uid = Number(userId);
  const values = validateSpecPayload(payload);
  return db.transaction(() => {
    if (values.source_ref) {
      const existing = db
        .prepare('SELECT * FROM spec_items WHERE user_id = ? AND source = ? AND source_ref = ?')
        .get(uid, values.source, values.source_ref);
      if (existing) return { ...decorate(existing), duplicate: true, automation: null };
    }
    const info = db.prepare(`
      INSERT INTO spec_items (user_id, kind, title, organizer, source, source_ref, source_url, status,
        apply_start, apply_end, event_date, end_date, result_date, memo)
      VALUES (@uid, @kind, @title, @organizer, @source, @source_ref, @source_url, @status,
        @apply_start, @apply_end, @event_date, @end_date, @result_date, @memo)
    `).run({ uid, ...values });
    const item = getRawSpecItem(db, uid, info.lastInsertRowid);
    const schedule = syncSpecSchedule(db, uid, { ...item, status: 'interested' });
    const status = applySpecStatusAutomation(db, uid, item, 'interested');
    return { ...getSpecItem(db, uid, item.id), duplicate: false, automation: { ...status, ...schedule } };
  })();
}

// An item matches a from/to window when any of its date columns falls inside it.
function dateRangeClause(from, to) {
  const hasFrom = Boolean(from) && isValidDate(from);
  const hasTo = Boolean(to) && isValidDate(to);
  if (!hasFrom && !hasTo) return null;
  const parts = DATE_FIELDS.map((field) => `(${field} IS NOT NULL${hasFrom ? ` AND ${field} >= ?` : ''}${hasTo ? ` AND ${field} <= ?` : ''})`);
  const params = DATE_FIELDS.flatMap(() => [...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])]);
  return { sql: `(${parts.join(' OR ')})`, params };
}

function byNextDate(a, b) {
  if (a.next && b.next) return a.next.date < b.next.date ? -1 : a.next.date > b.next.date ? 1 : 0;
  if (a.next) return -1;
  if (b.next) return 1;
  return 0;
}

function listSpecItems(db, userId, filters = {}) {
  const conditions = ['user_id = ?'];
  const params = [Number(userId)];
  const kind = text(filters.kind);
  const status = text(filters.status);
  const q = text(filters.q);
  if (SPEC_KINDS.includes(kind)) {
    conditions.push('kind = ?');
    params.push(kind);
  }
  if (SPEC_STATUSES.includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(title LIKE ? OR organizer LIKE ? OR memo LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const range = dateRangeClause(text(filters.from), text(filters.to));
  if (range) {
    conditions.push(range.sql);
    params.push(...range.params);
  }
  const rows = db
    .prepare(`SELECT * FROM spec_items WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC, id DESC`)
    .all(...params);
  const today = localDateString();
  return rows.map((row) => decorate(row, today)).sort(byNextDate);
}

function groupSpecBoard(items) {
  return BOARD_COLUMNS.map((column) => ({
    ...column,
    items: items.filter((item) => column.statuses.includes(item.status)),
  }));
}

// Partial update: keys absent (undefined) in payload keep their stored value.
function updateSpecItem(db, userId, id, payload = {}) {
  const uid = Number(userId);
  const existing = getRawSpecItem(db, uid, id);
  if (!existing) return null;
  const merged = { ...existing };
  for (const key of Object.keys(payload)) {
    if (payload[key] !== undefined) merged[key] = payload[key];
  }
  const values = validateSpecPayload(merged);
  try {
    return db.transaction(() => {
      db.prepare(`
        UPDATE spec_items SET kind = @kind, title = @title, organizer = @organizer, source = @source,
          source_ref = @source_ref, source_url = @source_url, status = @status, apply_start = @apply_start,
          apply_end = @apply_end, event_date = @event_date, end_date = @end_date, result_date = @result_date,
          memo = @memo, updated_at = datetime('now')
        WHERE id = @id AND user_id = @uid
      `).run({ ...values, id: existing.id, uid });
      const item = getRawSpecItem(db, uid, existing.id);
      const schedule = syncSpecSchedule(db, uid, item);
      const status = applySpecStatusAutomation(db, uid, item, existing.status);
      return { ...getSpecItem(db, uid, item.id), automation: { ...status, ...schedule } };
    })();
  } catch (err) {
    if (isUniqueViolation(err)) throw new SpecValidationError('같은 출처의 스펙이 이미 등록되어 있습니다.');
    throw err;
  }
}

function updateSpecStatus(db, userId, id, status) {
  const uid = Number(userId);
  const next = text(status);
  const existing = getRawSpecItem(db, uid, id);
  if (!existing) return null;
  if (!SPEC_STATUSES.includes(next)) throw new SpecValidationError('올바른 진행 상태를 선택해 주세요.');
  if (existing.status === next) return { ...decorate(existing), automation: null };
  return db.transaction(() => {
    db.prepare("UPDATE spec_items SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(next, existing.id, uid);
    const item = getRawSpecItem(db, uid, existing.id);
    const automation = applySpecStatusAutomation(db, uid, item, existing.status);
    return { ...getSpecItem(db, uid, item.id), automation };
  })();
}

// Linked auto events/todos are removed explicitly: migrated DBs lack the FK cascade.
function deleteSpecItem(db, userId, id) {
  const uid = Number(userId);
  return db.transaction(() => {
    const existing = getRawSpecItem(db, uid, id);
    if (!existing) return false;
    removeSpecSchedule(db, uid, existing.id);
    return db.prepare('DELETE FROM spec_items WHERE id = ? AND user_id = ?').run(existing.id, uid).changes > 0;
  })();
}

function getSpecLinks(db, userId, item) {
  const uid = Number(userId);
  const events = db
    .prepare('SELECT id, title, type, starts_at FROM events WHERE user_id = ? AND spec_item_id = ? ORDER BY starts_at ASC, id ASC')
    .all(uid, item.id);
  const todos = db
    .prepare('SELECT id, title, category, due_date, is_done FROM todos WHERE user_id = ? AND spec_item_id = ? ORDER BY is_done ASC, id ASC')
    .all(uid, item.id);
  const material = item.material_id ? getMaterialById(db, uid, item.material_id) : null;
  return { events, todos, material };
}

function specTimeline(item, today = localDateString()) {
  return scheduleSlots(item)
    .filter((slot) => item[slot.field])
    .map((slot) => ({
      field: slot.field,
      label: slot.label,
      date: item[slot.field],
      dday: calculateDday(item[slot.field]),
      isPast: item[slot.field] < today,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Dashboard widget: active items' 접수/시험 dates within the next `days` days.
// Field names in the UNION come from a fixed allowlist, never from input.
function listUpcomingSpecDates(db, userId, { days = 14, limit = 5, now = new Date() } = {}) {
  const today = localDateString(now);
  const until = localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const fields = ['apply_start', 'apply_end', 'event_date'];
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
  const union = fields
    .map((field) => `SELECT id, title, kind, status, '${field}' AS field, ${field} AS date FROM spec_items
      WHERE user_id = ? AND status IN (${placeholders}) AND ${field} IS NOT NULL AND ${field} >= ? AND ${field} <= ?`)
    .join(' UNION ALL ');
  const params = fields.flatMap(() => [Number(userId), ...ACTIVE_STATUSES, today, until]);
  return db
    .prepare(`SELECT * FROM (${union}) ORDER BY date ASC, id ASC LIMIT ?`)
    .all(...params, limit)
    .map((row) => {
      const slot = scheduleSlots(row).find((s) => s.field === row.field);
      const dday = calculateDday(row.date);
      return {
        ...row,
        label: slot ? slot.label : '',
        kind_label: KIND_LABELS[row.kind] || row.kind,
        dday,
        isUrgent: dday.days !== null && dday.days <= 3,
        href: `/specs/${row.id}`,
      };
    });
}

// Internal helpers (text, decorate) stay private to the service layer.
const { text: _text, decorate: _decorate, ...publicModel } = model;

module.exports = {
  ...publicModel,
  ...watchService,
  createSpecItem,
  getSpecItem,
  listSpecItems,
  groupSpecBoard,
  updateSpecItem,
  updateSpecStatus,
  deleteSpecItem,
  getSpecLinks,
  specTimeline,
  listUpcomingSpecDates,
};
