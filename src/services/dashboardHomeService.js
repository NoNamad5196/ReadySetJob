const {
  APPLICATION_STAGES,
  STAGE_LABELS,
  BOARD_STAGE_LABELS,
  RESULT_LABELS,
  TODO_CATEGORY_LABELS,
  calculateDday,
} = require('../middleware/validation');
const { STAGE_INDEX_MAP, computeConversionStats } = require('./statsService');

const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

function toIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatKoreanDateLabel(dateStr, includeWeekdayLong = false) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return includeWeekdayLong
    ? `${m}월 ${d}일 ${WEEKDAY_LONG[dt.getDay()]}`
    : `${m}월 ${d}일(${WEEKDAY_SHORT[dt.getDay()]})`;
}

function formatRelativeTime(rawTs, now = new Date()) {
  if (!rawTs) return '방금 전';
  const str = String(rawTs).trim();
  let parsed = new Date(str.includes('T') ? str : `${str.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + 60000) {
    parsed = new Date(str.replace(' ', 'T'));
  }
  if (Number.isNaN(parsed.getTime())) return str.slice(0, 10);
  const diffMin = Math.floor(Math.max(0, now.getTime() - parsed.getTime()) / 60000);
  if (diffMin < 5) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? '어제' : `${diffDays}일 전`;
}

function buildTodayObject(now = new Date()) {
  const iso = toIsoDate(now);
  const label = formatKoreanDateLabel(iso, true);
  const obj = { date: iso, iso, label, month: now.getMonth() + 1, day: now.getDate(), weekday: WEEKDAY_LONG[now.getDay()], weekdayShort: WEEKDAY_SHORT[now.getDay()] };
  Object.defineProperties(obj, {
    toString: { value() { return this.label; }, enumerable: false },
    slice: { value(...args) { return this.date.slice(...args); }, enumerable: false },
  });
  return obj;
}

function buildHeroDeadline(db, uid, todayIso) {
  const deadlines = db.prepare(`
    SELECT jp.id AS job_post_id, jp.title AS job_title, COALESCE(NULLIF(jp.position, ''), jp.title) AS position,
           jp.deadline AS date, jp.memo, c.name AS company, a.id AS application_id, COALESCE(a.stage, 'document') AS stage
    FROM job_posts jp INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
    LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
    WHERE jp.user_id = ? AND jp.deadline IS NOT NULL AND date(jp.deadline) >= date(?) AND (a.id IS NULL OR a.result = 'in_progress')
    ORDER BY jp.deadline ASC, jp.id ASC LIMIT 5
  `).all(uid, todayIso).map((r) => ({
    id: r.job_post_id, type: 'deadline', application_id: r.application_id || null, job_post_id: r.job_post_id,
    company: r.company, position: r.position, job_title: r.job_title, title: `${r.company} 서류 마감`,
    stage: r.stage, date: r.date, dateLabel: `${formatKoreanDateLabel(r.date)} 23:59까지`, memo: r.memo || '', priority: r.application_id ? 0 : 1,
  }));

  const events = db.prepare(`
    SELECT e.id AS event_id, e.title, e.starts_at, e.memo, e.application_id, a.stage,
           jp.id AS job_post_id, jp.title AS job_title, COALESCE(NULLIF(jp.position, ''), jp.title) AS position, c.name AS company
    FROM events e LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
    LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
    LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
    WHERE e.user_id = ? AND date(e.starts_at) >= date(?) ORDER BY e.starts_at ASC, e.id ASC LIMIT 5
  `).all(uid, todayIso).map((r) => {
    const date = String(r.starts_at || '').slice(0, 10);
    const time = String(r.starts_at || '').slice(11, 16) || '14:00';
    return {
      id: r.event_id, type: 'event', application_id: r.application_id || null, job_post_id: r.job_post_id || null,
      company: r.company || r.title, position: r.position || r.title, job_title: r.job_title || r.title,
      title: r.title, stage: r.stage || 'document', date, dateLabel: `${formatKoreanDateLabel(date)} ${time}`, memo: r.memo || '', priority: 2,
    };
  });

  const all = [...deadlines, ...events].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.priority - b.priority);
  if (all.length === 0) return null;
  const chosen = all[0];

  const essayRow = chosen.application_id
    ? db.prepare('SELECT id, title FROM essays WHERE user_id = ? AND application_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(uid, chosen.application_id)
    : null;
  const qRows = essayRow
    ? db.prepare('SELECT id, sort_order, question, answer FROM essay_questions WHERE essay_id = ? ORDER BY sort_order ASC, id ASC').all(essayRow.id)
    : [];
  const total = qRows.length;
  const answered = qRows.filter((q) => String(q.answer || '').trim().length > 0).length;
  const dday = calculateDday(chosen.date);

  return {
    ...chosen, company_name: chosen.company, stage_label: STAGE_LABELS[chosen.stage] || chosen.stage,
    deadline: chosen.date, dayOfMonth: Number(String(chosen.date).slice(8, 10)) || null, dday, ddayLabel: dday.label,
    essay_id: essayRow ? essayRow.id : null,
    essayProgress: { id: essayRow ? essayRow.id : null, answered, total },
    essay: { id: essayRow ? essayRow.id : null, title: essayRow ? essayRow.title : null, answered, total },
    answered, total,
    href: chosen.application_id ? `/applications/${chosen.application_id}` : chosen.job_post_id ? `/jobs/${chosen.job_post_id}` : '/events',
    essayHref: essayRow ? `/essays/${essayRow.id}` : '/essays',
    jobHref: chosen.job_post_id ? `/jobs/${chosen.job_post_id}` : '/jobs',
  };
}

function buildWeekSchedule(db, uid, now, todayIso) {
  const dow = now.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon + i);
    const iso = toIsoDate(d);
    return { date: iso, day: d.getDate(), label: `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}`, weekday: WEEKDAY_SHORT[d.getDay()], isToday: iso === todayIso, items: [] };
  });
  const dayMap = new Map(days.map((d) => [d.date, d]));

  db.prepare(`
    SELECT jp.id, jp.deadline, c.name AS company_name, a.id AS application_id
    FROM job_posts jp INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id
    LEFT JOIN applications a ON a.job_post_id = jp.id AND a.user_id = jp.user_id
    WHERE jp.user_id = ? AND jp.deadline >= ? AND jp.deadline <= ? ORDER BY jp.deadline ASC, jp.id ASC
  `).all(uid, days[0].date, days[6].date).forEach((dl) => {
    dayMap.get(dl.deadline)?.items.push({
      title: `${dl.company_name} 서류 마감`, type: 'deadline', time: '23:59',
      company: dl.company_name, dday: calculateDday(dl.deadline),
      href: dl.application_id ? `/applications/${dl.application_id}` : `/jobs/${dl.id}`,
    });
  });

  db.prepare(`
    SELECT e.id, e.title, e.type, e.starts_at, e.application_id, c.name AS company_name
    FROM events e LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
    LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
    LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
    WHERE e.user_id = ? AND substr(e.starts_at, 1, 10) >= ? AND substr(e.starts_at, 1, 10) <= ? ORDER BY e.starts_at ASC, e.id ASC
  `).all(uid, days[0].date, days[6].date).forEach((ev) => {
    const dStr = String(ev.starts_at || '').slice(0, 10);
    dayMap.get(dStr)?.items.push({
      title: ev.title, type: ev.type, time: String(ev.starts_at || '').slice(11, 16) || '14:00',
      company: ev.company_name || '', dday: calculateDday(dStr),
      href: ev.application_id ? `/applications/${ev.application_id}` : '/events',
    });
  });
  return days;
}

function getDashboardHome(db, userId, now = new Date()) {
  const uid = Number(userId);
  const todayObj = buildTodayObject(now);
  const todayIso = todayObj.date;
  const heroDeadline = buildHeroDeadline(db, uid, todayIso);
  const week = buildWeekSchedule(db, uid, now, todayIso);

  const inProgress = db.prepare(`
    SELECT a.id, a.stage, a.result, a.is_favorite, jp.title AS job_title,
           COALESCE(NULLIF(jp.position, ''), jp.title) AS position, jp.deadline AS job_deadline, c.name AS company,
           (SELECT e.title FROM events e WHERE e.application_id = a.id AND e.user_id = a.user_id AND date(e.starts_at) >= date(?) ORDER BY e.starts_at ASC, e.id ASC LIMIT 1) AS next_event_title,
           (SELECT e.starts_at FROM events e WHERE e.application_id = a.id AND e.user_id = a.user_id AND date(e.starts_at) >= date(?) ORDER BY e.starts_at ASC, e.id ASC LIMIT 1) AS next_event_starts_at
    FROM applications a INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id
    INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id
    WHERE a.user_id = ? AND a.result = 'in_progress'
  `).all(todayIso, todayIso, uid).map((r) => {
    const evDate = r.next_event_starts_at ? String(r.next_event_starts_at).slice(0, 10) : null;
    const evTime = r.next_event_starts_at ? String(r.next_event_starts_at).slice(11, 16) : null;
    const nextDate = evDate || r.job_deadline || null;
    const nextLabel = evDate ? `${formatKoreanDateLabel(evDate)}${evTime ? ' ' + evTime : ''} · ${r.next_event_title}` : r.job_deadline ? `${formatKoreanDateLabel(r.job_deadline)} 23:59 마감` : '일정 미정';
    const dday = calculateDday(nextDate);
    return { id: r.id, company: r.company, company_name: r.company, position: r.position, job_title: r.job_title, stage: r.stage, stage_label: BOARD_STAGE_LABELS[r.stage] || STAGE_LABELS[r.stage] || r.stage, stageIndex: STAGE_INDEX_MAP[r.stage] ?? 0, nextDate, nextLabel, dday, ddayLabel: dday.label, is_favorite: Number(r.is_favorite) ? 1 : 0, href: `/applications/${r.id}` };
  }).sort((a, b) => (a.nextDate && b.nextDate ? a.nextDate.localeCompare(b.nextDate) : a.nextDate ? -1 : b.nextDate ? 1 : b.id - a.id));

  const openTodoRows = db.prepare(`
    SELECT t.*, c.name AS company_name FROM todos t
    LEFT JOIN applications a ON a.id = t.application_id AND a.user_id = t.user_id
    LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = t.user_id
    LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = t.user_id
    WHERE t.user_id = ? AND t.is_done = 0 AND (t.due_date IS NULL OR date(t.due_date) <= date(?))
    ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END ASC, t.due_date ASC, t.id ASC
  `).all(uid, todayIso).map((t) => ({ ...t, is_done: 0, category_label: TODO_CATEGORY_LABELS[t.category] || '기타' }));

  const doneCount = Number(db.prepare('SELECT COUNT(*) AS cnt FROM todos WHERE user_id = ? AND is_done = 1 AND (due_date = ? OR date(done_at) = date(?) OR due_date IS NULL)').get(uid, todayIso, todayIso).cnt) || 0;
  const totalCount = openTodoRows.length + doneCount;
  const todosToday = openTodoRows.slice(0, 6);
  todosToday.items = [...todosToday];
  todosToday.doneCount = doneCount;
  todosToday.totalCount = totalCount;
  todosToday.remainingCount = openTodoRows.length;

  const nextIntRow = db.prepare(`
    SELECT e.id, e.application_id, e.title, e.starts_at, e.memo, c.name AS company, COALESCE(NULLIF(jp.position, ''), jp.title) AS position, a.stage
    FROM events e LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id
    LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id
    LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id
    WHERE e.user_id = ? AND e.type = 'interview' AND date(e.starts_at) >= date(?) ORDER BY e.starts_at ASC, e.id ASC LIMIT 1
  `).get(uid, todayIso);

  const nextInterview = nextIntRow ? { ...nextIntRow, company_name: nextIntRow.company, date: String(nextIntRow.starts_at || '').slice(0, 10), time: String(nextIntRow.starts_at || '').slice(11, 16) || '14:00', dateLabel: `${formatKoreanDateLabel(String(nextIntRow.starts_at || '').slice(0, 10))} ${String(nextIntRow.starts_at || '').slice(11, 16) || '14:00'}`, dday: calculateDday(String(nextIntRow.starts_at || '').slice(0, 10)), href: nextIntRow.application_id ? `/applications/${nextIntRow.application_id}` : '/interview-prep' } : null;

  const stageItems = db.prepare(`SELECT sl.changed_at AS ts, sl.from_stage, sl.to_stage, sl.to_result, a.id AS app_id, c.name AS company, COALESCE(NULLIF(jp.position, ''), jp.title) AS pos FROM stage_logs sl INNER JOIN applications a ON a.id = sl.application_id INNER JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = a.user_id INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = a.user_id WHERE a.user_id = ? ORDER BY sl.changed_at DESC, sl.id DESC LIMIT 6`).all(uid).map((r) => ({ type: 'stage_change', title: `${r.company} ${BOARD_STAGE_LABELS[r.to_stage] || r.to_stage} (${RESULT_LABELS[r.to_result] || r.to_result})`, subtitle: `${r.pos} · ${r.from_stage ? (BOARD_STAGE_LABELS[r.from_stage] || r.from_stage) + ' → ' : ''}${BOARD_STAGE_LABELS[r.to_stage] || r.to_stage}`, timestamp: r.ts, href: `/applications/${r.app_id}` }));
  const essayVerItems = db.prepare(`SELECT ev.created_at AS ts, ev.version_no, ev.label, e.id AS essay_id, e.title, c.name AS company FROM essay_versions ev INNER JOIN essays e ON e.id = ev.essay_id LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id LEFT JOIN job_posts jp ON jp.id = a.job_post_id AND jp.user_id = e.user_id LEFT JOIN companies c ON c.id = jp.company_id AND c.user_id = e.user_id WHERE e.user_id = ? ORDER BY ev.created_at DESC, ev.id DESC LIMIT 6`).all(uid).map((r) => ({ type: 'essay_version', title: `${r.company ? r.company + ' ' : ''}자기소개서 수정`, subtitle: `${r.title} · v${r.version_no}${r.label ? ' (' + r.label + ')' : ''}`, timestamp: r.ts, href: `/essays/${r.essay_id}` }));
  const jobItems = db.prepare(`SELECT jp.created_at AS ts, jp.id AS job_id, jp.title, jp.position, jp.deadline, c.name AS company FROM job_posts jp INNER JOIN companies c ON c.id = jp.company_id AND c.user_id = jp.user_id WHERE jp.user_id = ? ORDER BY jp.created_at DESC, jp.id DESC LIMIT 4`).all(uid).map((r) => ({ type: 'job_post', title: `${r.company} ${r.position || r.title} 공고 저장`, subtitle: `채용 공고 · ${r.deadline ? r.deadline + ' 마감' : '상시 채용'}`, timestamp: r.ts, href: `/jobs/${r.job_id}` }));
  const todoDoneItems = db.prepare(`SELECT COALESCE(done_at, updated_at, created_at) AS ts, title, category FROM todos WHERE user_id = ? AND is_done = 1 ORDER BY ts DESC, id DESC LIMIT 4`).all(uid).map((r) => ({ type: 'todo_done', title: `${r.title} 완료`, subtitle: `할 일 · ${TODO_CATEGORY_LABELS[r.category] || '기타'}`, timestamp: r.ts, href: '/todos' }));

  const recent = [...stageItems, ...essayVerItems, ...jobItems, ...todoDoneItems]
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 8)
    .map((item) => { const rel = formatRelativeTime(item.timestamp, now); return { ...item, relativeTime: rel, timeLabel: rel, when: rel }; });

  const totalsRow = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN result = 'in_progress' THEN 1 ELSE 0 END) AS in_progress, SUM(CASE WHEN result = 'passed' THEN 1 ELSE 0 END) AS passed, SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) AS failed FROM applications WHERE user_id = ?`).get(uid);
  const conv = computeConversionStats(db, uid, now);
  const stats = { total: Number(totalsRow?.total) || 0, inProgress: Number(totalsRow?.in_progress) || 0, passed: Number(totalsRow?.passed) || 0, failed: Number(totalsRow?.failed) || 0, documentPassRate: conv.documentPassRate, monthDelta: conv.monthDelta, thisMonthCount: conv.thisMonthCount, lastMonthCount: conv.lastMonthCount, stages: APPLICATION_STAGES };

  return { today: todayObj, todayDate: todayIso, todayLabel: todayObj.label, heroDeadline, week, inProgress, todosToday, todosDoneCount: doneCount, todosTotalCount: totalCount, nextInterview, recent, stats };
}

module.exports = { getDashboardHome, formatRelativeTime, formatKoreanDateLabel };
