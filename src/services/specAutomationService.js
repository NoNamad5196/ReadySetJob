// Spec-item automation. Every side effect is idempotent and keyed by
// spec_item_id so re-running never duplicates events, todos or materials.
// Callers run these inside the surrounding db.transaction of specsService.

const { createMaterial, getMaterialById } = require('./materialsService');

const TODO_TITLE_MAX = 120;
const ACTIVE_STATUSES = ['interested', 'applied', 'in_progress'];
const MATERIAL_STATUSES = ['completed', 'passed'];

const KIND_LABELS = {
  certificate: '자격증',
  bootcamp: '부트캠프·교육',
  contest: '공모전',
  activity: '대외활동',
  grad_school: '대학원',
  other: '기타',
};

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// One schedule slot per date column. Labels are reused by views and the dashboard.
function scheduleSlots(item) {
  const isCert = item.kind === 'certificate';
  return [
    { field: 'apply_start', label: '접수 시작', type: 'other', time: '09:00' },
    { field: 'apply_end', label: '접수 마감', type: 'deadline', time: '18:00' },
    { field: 'event_date', label: isCert ? '시험' : '시작', type: isCert ? 'test' : 'other', time: '09:00' },
    { field: 'end_date', label: '종료', type: 'other', time: '09:00', timelineOnly: true },
    { field: 'result_date', label: '결과 발표', type: 'announcement', time: '09:00' },
  ];
}

function eventTitle(item, slot) {
  return `[${item.title}] ${slot.label}`;
}

function todoTitle(item) {
  return clip(`[${item.title}] ${item.kind === 'certificate' ? '원서 접수' : '신청서 제출'}`, TODO_TITLE_MAX);
}

// Creates/updates/removes the spec's auto events so they mirror its dates.
function syncSpecEvents(db, uid, item) {
  const desired = scheduleSlots(item)
    .filter((slot) => !slot.timelineOnly && item[slot.field])
    .map((slot) => ({
      title: eventTitle(item, slot),
      type: slot.type,
      startsAt: `${item[slot.field]}T${slot.time}`,
    }));
  const existing = db
    .prepare('SELECT id, title, type, starts_at FROM events WHERE user_id = ? AND spec_item_id = ?')
    .all(uid, item.id);
  const byTitle = new Map(existing.map((row) => [row.title, row]));
  const keep = new Set();
  let created = 0;

  for (const want of desired) {
    const row = byTitle.get(want.title);
    if (row) {
      keep.add(row.id);
      if (row.starts_at !== want.startsAt || row.type !== want.type) {
        db.prepare('UPDATE events SET starts_at = ?, type = ? WHERE id = ? AND user_id = ?')
          .run(want.startsAt, want.type, row.id, uid);
      }
      continue;
    }
    db.prepare(`
      INSERT INTO events (user_id, spec_item_id, title, type, starts_at, memo)
      VALUES (?, ?, ?, ?, ?, '스펙 관리에서 자동 등록된 일정')
    `).run(uid, item.id, want.title, want.type, want.startsAt);
    created += 1;
  }

  for (const row of existing) {
    if (!keep.has(row.id)) db.prepare('DELETE FROM events WHERE id = ? AND user_id = ?').run(row.id, uid);
  }
  return created;
}

// The single auto todo per spec: created while the item is still "interested".
function syncSpecTodo(db, uid, item) {
  const title = todoTitle(item);
  const existing = db
    .prepare('SELECT id, title, due_date, is_done FROM todos WHERE user_id = ? AND spec_item_id = ? ORDER BY id ASC LIMIT 1')
    .get(uid, item.id);
  if (existing) {
    if (!existing.is_done && (existing.title !== title || existing.due_date !== (item.apply_end || null))) {
      db.prepare("UPDATE todos SET title = ?, due_date = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(title, item.apply_end || null, existing.id, uid);
    }
    return false;
  }
  if (item.status !== 'interested') return false;
  db.prepare("INSERT INTO todos (user_id, spec_item_id, title, category, due_date) VALUES (?, ?, ?, 'other', ?)")
    .run(uid, item.id, title, item.apply_end || null);
  return true;
}

function syncSpecSchedule(db, userId, item) {
  const uid = Number(userId);
  if (!ACTIVE_STATUSES.includes(item.status)) {
    return { eventsCreated: 0, todoCreated: false };
  }
  return {
    eventsCreated: syncSpecEvents(db, uid, item),
    todoCreated: syncSpecTodo(db, uid, item),
  };
}

function cleanupFutureSchedule(db, userId, specId, today = localDateString()) {
  const uid = Number(userId);
  const events = db
    .prepare('DELETE FROM events WHERE user_id = ? AND spec_item_id = ? AND date(starts_at) >= date(?)')
    .run(uid, specId, today).changes;
  const todos = db
    .prepare('DELETE FROM todos WHERE user_id = ? AND spec_item_id = ? AND is_done = 0')
    .run(uid, specId).changes;
  return { eventsRemoved: events, todosRemoved: todos };
}

function removeSpecSchedule(db, userId, specId) {
  const uid = Number(userId);
  db.prepare('DELETE FROM events WHERE user_id = ? AND spec_item_id = ?').run(uid, specId);
  db.prepare('DELETE FROM todos WHERE user_id = ? AND spec_item_id = ?').run(uid, specId);
}

function materialShape(item) {
  const passed = item.status === 'passed';
  switch (item.kind) {
    case 'certificate':
      return { kind: 'award', tags: '자격증' };
    case 'contest':
      return passed ? { kind: 'award', tags: '공모전,수상' } : { kind: 'activity', tags: '공모전' };
    case 'bootcamp':
      return { kind: 'project', tags: '교육,부트캠프' };
    case 'activity':
      return { kind: 'activity', tags: '대외활동' };
    case 'grad_school':
      return { kind: 'other', tags: '대학원' };
    default:
      return { kind: 'other', tags: '스펙' };
  }
}

function materialPeriod(item) {
  const start = item.event_date || item.apply_start || '';
  const end = item.end_date || item.result_date || '';
  if (start && end && start !== end) return `${start} ~ ${end}`;
  return start || end || '';
}

function materialContent(item) {
  const lines = ['스펙 관리에서 자동 생성된 초안입니다. 상황·과제·행동·결과(STAR)를 보완해 주세요.', ''];
  lines.push(`- 종류: ${KIND_LABELS[item.kind] || item.kind}`);
  if (item.organizer) lines.push(`- 주최·시행: ${item.organizer}`);
  lines.push(`- 결과: ${item.status === 'passed' ? '합격' : '완료'}`);
  for (const slot of scheduleSlots(item)) {
    if (item[slot.field]) lines.push(`- ${slot.label}: ${item[slot.field]}`);
  }
  if (item.source_url) lines.push(`- 출처: ${item.source_url}`);
  if (item.memo) lines.push('', item.memo);
  return lines.join('\n');
}

// Returns true when a new material was created and linked.
function ensureSpecMaterial(db, userId, item) {
  const uid = Number(userId);
  if (!MATERIAL_STATUSES.includes(item.status)) return false;
  if (item.material_id && getMaterialById(db, uid, item.material_id)) return false;
  const shape = materialShape(item);
  const material = createMaterial(db, uid, {
    kind: shape.kind,
    title: item.title,
    period: materialPeriod(item),
    content: materialContent(item),
    tags: shape.tags,
  });
  db.prepare("UPDATE spec_items SET material_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(material.id, item.id, uid);
  return true;
}

function completeApplyTodo(db, userId, specId) {
  return db
    .prepare("UPDATE todos SET is_done = 1, done_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND spec_item_id = ? AND is_done = 0")
    .run(Number(userId), specId).changes;
}

// Status-transition side effects (completed/passed → material, dropped → cleanup,
// leaving 관심 → the auto 원서 접수/신청서 제출 todo is marked done).
function applySpecStatusAutomation(db, userId, item, previousStatus) {
  const result = { materialCreated: false, eventsRemoved: 0, todosRemoved: 0, eventsCreated: 0, todoCreated: false, todosCompleted: 0 };
  if (!item || item.status === previousStatus) return result;
  if (previousStatus === 'interested' && item.status !== 'dropped') {
    result.todosCompleted = completeApplyTodo(db, userId, item.id);
  }
  if (item.status === 'dropped') {
    Object.assign(result, cleanupFutureSchedule(db, userId, item.id));
  } else if (MATERIAL_STATUSES.includes(item.status)) {
    result.materialCreated = ensureSpecMaterial(db, userId, item);
  } else if (previousStatus === 'dropped') {
    Object.assign(result, syncSpecSchedule(db, userId, item));
  }
  return result;
}

module.exports = {
  KIND_LABELS,
  ACTIVE_STATUSES,
  localDateString,
  scheduleSlots,
  eventTitle,
  todoTitle,
  materialShape,
  syncSpecSchedule,
  cleanupFutureSchedule,
  removeSpecSchedule,
  ensureSpecMaterial,
  applySpecStatusAutomation,
};
