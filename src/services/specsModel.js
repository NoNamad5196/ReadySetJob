// 스펙 관리 domain model: enums, labels, payload validation and view decoration.
// Pure functions only (no DB access) so routes, services and tests share one source.

const { isValidDate, isValidUrl, calculateDday } = require('../middleware/validation');
const { KIND_LABELS, localDateString, scheduleSlots } = require('./specAutomationService');

const SPEC_KINDS = ['certificate', 'bootcamp', 'contest', 'activity', 'grad_school', 'other'];
const SPEC_SOURCES = ['qnet', 'dataq', 'alio', 'work24', 'ai_verified', 'manual'];
const SPEC_STATUSES = ['interested', 'applied', 'in_progress', 'completed', 'passed', 'failed', 'dropped'];
const DATE_FIELDS = ['apply_start', 'apply_end', 'event_date', 'end_date', 'result_date'];
const OFFICIAL_SOURCES = ['qnet', 'dataq', 'alio', 'work24'];

const STATUS_LABELS = {
  interested: '관심',
  applied: '신청·접수',
  in_progress: '진행·응시',
  completed: '완료',
  passed: '합격',
  failed: '불합격',
  dropped: '중단',
};

const BOARD_COLUMNS = [
  { key: 'interested', label: '관심', statuses: ['interested'] },
  { key: 'applied', label: '신청·접수', statuses: ['applied'] },
  { key: 'in_progress', label: '진행·응시', statuses: ['in_progress'] },
  { key: 'done', label: '완료·합격', statuses: ['completed', 'passed'] },
  { key: 'closed', label: '불합격·중단', statuses: ['failed', 'dropped'] },
];

const SOURCE_LABELS = {
  qnet: 'Q-Net',
  dataq: '데이터자격',
  alio: 'ALIO',
  work24: '고용24',
  ai_verified: '자동 검증',
  manual: '직접 입력',
};

const TITLE_MAX = 200;
const TEXT_MAX = 200;
const MEMO_MAX = 5000;
const URL_MAX = 2000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

class SpecValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpecValidationError';
    this.status = 422;
    this.code = 'SPEC_VALIDATION';
    this.expose = true;
  }
}

const text = (value) => (value === undefined || value === null ? '' : String(value).trim());
const nullable = (value) => text(value) || null;

function formatSpecDate(date) {
  if (!date || !isValidDate(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} (${weekday})`;
}

function sourceBadge(source) {
  const official = OFFICIAL_SOURCES.includes(source);
  return {
    tier: official ? 'official' : source === 'ai_verified' ? 'verified' : 'manual',
    label: official ? '공식' : SOURCE_LABELS[source] || '직접 입력',
    origin: SOURCE_LABELS[source] || source,
  };
}

function nextDate(item, today = localDateString()) {
  const upcoming = scheduleSlots(item)
    .filter((slot) => item[slot.field] && item[slot.field] >= today)
    .sort((a, b) => (item[a.field] < item[b.field] ? -1 : 1))[0];
  if (!upcoming) return null;
  const date = item[upcoming.field];
  return { field: upcoming.field, label: upcoming.label, date, dday: calculateDday(date) };
}

function decorate(row, today) {
  if (!row) return null;
  return {
    ...row,
    kind_label: KIND_LABELS[row.kind] || row.kind,
    status_label: STATUS_LABELS[row.status] || row.status,
    source_badge: sourceBadge(row.source),
    next: nextDate(row, today),
  };
}

function normalizePayload(payload = {}) {
  const values = {
    kind: text(payload.kind) || 'other',
    title: text(payload.title),
    organizer: nullable(payload.organizer),
    source: text(payload.source) || 'manual',
    source_ref: nullable(payload.source_ref),
    source_url: nullable(payload.source_url),
    status: text(payload.status) || 'interested',
    memo: nullable(payload.memo),
  };
  for (const field of DATE_FIELDS) values[field] = nullable(payload[field]);
  return values;
}

function validationMessage(values) {
  if (!values.title) return '제목을 입력해 주세요.';
  if (values.title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하로 입력해 주세요.`;
  if (!SPEC_KINDS.includes(values.kind)) return '올바른 스펙 종류를 선택해 주세요.';
  if (!SPEC_SOURCES.includes(values.source)) return '올바른 출처(source)를 선택해 주세요.';
  if (!SPEC_STATUSES.includes(values.status)) return '올바른 진행 상태를 선택해 주세요.';
  if (values.organizer && values.organizer.length > TEXT_MAX) return `주최·시행 기관은 ${TEXT_MAX}자 이하로 입력해 주세요.`;
  if (values.source_ref && values.source_ref.length > TEXT_MAX) return '출처 ID가 너무 깁니다.';
  if (values.memo && values.memo.length > MEMO_MAX) return `메모는 ${MEMO_MAX}자 이하로 입력해 주세요.`;
  if (values.source_url && (values.source_url.length > URL_MAX || !isValidUrl(values.source_url))) {
    return '출처 URL은 http:// 또는 https://로 시작해야 합니다.';
  }
  for (const field of DATE_FIELDS) {
    if (values[field] && !isValidDate(values[field])) return '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).';
  }
  if (values.apply_start && values.apply_end && values.apply_start > values.apply_end) {
    return '접수 시작일은 접수 마감일보다 늦을 수 없습니다.';
  }
  if (values.event_date && values.end_date && values.event_date > values.end_date) {
    return '종료일은 시험·시작일보다 빠를 수 없습니다.';
  }
  return null;
}

function validateSpecPayload(payload) {
  const values = normalizePayload(payload);
  const message = validationMessage(values);
  if (message) throw new SpecValidationError(message);
  return values;
}

module.exports = {
  SPEC_KINDS,
  SPEC_SOURCES,
  SPEC_STATUSES,
  DATE_FIELDS,
  STATUS_LABELS,
  KIND_LABELS,
  SOURCE_LABELS,
  BOARD_COLUMNS,
  SpecValidationError,
  text,
  formatSpecDate,
  sourceBadge,
  decorate,
  validateSpecPayload,
};
