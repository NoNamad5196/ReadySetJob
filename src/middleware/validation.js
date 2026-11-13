const { companyAvatar } = require('../utils/avatar');

const EMPLOYMENT_TYPES = ['intern', 'new_grad', 'experienced', 'other'];
const APPLICATION_STAGES = [
  'document',
  'coding_test',
  'assignment',
  'interview1',
  'interview2',
  'final',
];
const APPLICATION_RESULTS = ['in_progress', 'passed', 'failed', 'withdrawn'];
const EVENT_TYPES = ['deadline', 'test', 'interview', 'announcement', 'other'];
const MATERIAL_KINDS = ['experience', 'project', 'award', 'activity', 'other'];
const TODO_CATEGORIES = ['essay', 'interview', 'coding_test', 'assignment', 'other'];

const TODO_CATEGORY_LABELS = {
  essay: '자기소개서',
  interview: '면접 준비',
  coding_test: '코딩 테스트',
  assignment: '과제',
  other: '기타',
};

const MATERIAL_KIND_LABELS = {
  experience: '경험',
  project: '프로젝트',
  award: '수상',
  activity: '대외활동',
  other: '기타',
};

const EMPLOYMENT_TYPE_LABELS = {
  intern: '인턴',
  new_grad: '신입',
  experienced: '경력',
  other: '기타',
};

const STAGE_LABELS = {
  document: '서류전형',
  coding_test: '코딩테스트',
  assignment: '과제전형',
  interview1: '1차면접',
  interview2: '2차면접',
  final: '최종전형',
};

const BOARD_STAGE_LABELS = {
  document: '서류',
  coding_test: '코딩테스트',
  assignment: '과제',
  interview1: '1차 면접',
  interview2: '2차 면접',
  final: '최종',
};

const RESULT_LABELS = {
  in_progress: '진행중',
  passed: '합격',
  failed: '불합격',
  withdrawn: '지원취소',
};

const EVENT_TYPE_LABELS = {
  deadline: '서류/과제 마감',
  test: '코딩테스트/필기',
  interview: '면접',
  announcement: '결과 발표',
  other: '기타 일정',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const SAFE_REDIRECT_REGEX = /^\/(?![\/\\])/;
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;
const POSITIVE_INTEGER_REGEX = /^\s*\d+\s*$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

function isValidDate(dateStr) {
  if (dateStr === undefined || dateStr === null) return true;
  if (typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  if (!trimmed) return true;
  if (!DATE_REGEX.test(trimmed)) return false;

  const [yStr, mStr, dStr] = trimmed.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12) return false;

  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function isValidDateTime(dtStr) {
  if (typeof dtStr !== 'string' || !dtStr.trim()) {
    return false;
  }
  const trimmed = dtStr.trim();
  const match = trimmed.match(DATETIME_REGEX);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;

  if (month < 1 || month > 12) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function safeRedirectPath(value, fallback = '/') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (
    !SAFE_REDIRECT_REGEX.test(trimmed) ||
    trimmed.includes('://') ||
    trimmed.includes('\\') ||
    CONTROL_CHARS_REGEX.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

function parseId(value) {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'string' && !POSITIVE_INTEGER_REGEX.test(value)) {
    return null;
  }
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function isValidUrl(urlStr) {
  if (!urlStr || !urlStr.trim()) return true;
  try {
    const parsed = new URL(urlStr.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function withDdayString(ddayObj) {
  Object.defineProperty(ddayObj, 'toString', {
    value() {
      return this.label;
    },
    enumerable: false,
  });
  return ddayObj;
}

function calculateDday(deadlineStr) {
  if (!deadlineStr || !DATE_REGEX.test(deadlineStr)) {
    return withDdayString({ label: '상시/미정', state: 'none', days: null });
  }
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = deadlineStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  const diffDays = Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return withDdayString({ label: 'D-Day', state: 'urgent', days: 0 });
  }
  if (diffDays > 0) {
    return withDdayString({
      label: `D-${diffDays}`,
      state: diffDays <= 3 ? 'urgent' : diffDays <= 7 ? 'soon' : 'upcoming',
      days: diffDays,
    });
  }
  return withDdayString({ label: `마감 (D+${Math.abs(diffDays)})`, state: 'expired', days: diffDays });
}

function normalizeTags(tagsStr) {
  if (!tagsStr) return '';
  return String(tagsStr)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(',');
}

function attachUiHelpers(req, res, next) {
  res.locals.EMPLOYMENT_TYPES = EMPLOYMENT_TYPES;
  res.locals.APPLICATION_STAGES = APPLICATION_STAGES;
  res.locals.APPLICATION_RESULTS = APPLICATION_RESULTS;
  res.locals.EVENT_TYPES = EVENT_TYPES;
  res.locals.MATERIAL_KINDS = MATERIAL_KINDS;
  res.locals.EMPLOYMENT_TYPE_LABELS = EMPLOYMENT_TYPE_LABELS;
  res.locals.STAGE_LABELS = STAGE_LABELS;
  res.locals.BOARD_STAGE_LABELS = BOARD_STAGE_LABELS;
  res.locals.RESULT_LABELS = RESULT_LABELS;
  res.locals.EVENT_TYPE_LABELS = EVENT_TYPE_LABELS;
  res.locals.MATERIAL_KIND_LABELS = MATERIAL_KIND_LABELS;
  res.locals.TODO_CATEGORIES = TODO_CATEGORIES;
  res.locals.TODO_CATEGORY_LABELS = TODO_CATEGORY_LABELS;
  res.locals.calculateDday = calculateDday;
  res.locals.companyAvatar = companyAvatar;
  try {
    const { isAiEnabled, getAiConfig, AI_DISABLED_MESSAGE } = require('../services/aiService');
    res.locals.aiEnabled = isAiEnabled();
    res.locals.aiConfig = getAiConfig();
    res.locals.AI_DISABLED_MESSAGE = AI_DISABLED_MESSAGE;
  } catch (_err) {
    res.locals.aiEnabled = false;
    res.locals.aiConfig = { enabled: false, features: [] };
    res.locals.AI_DISABLED_MESSAGE = 'AI 기능을 지금은 사용할 수 없습니다';
  }
  next();
}

module.exports = {
  EMPLOYMENT_TYPES,
  APPLICATION_STAGES,
  APPLICATION_RESULTS,
  EVENT_TYPES,
  MATERIAL_KINDS,
  TODO_CATEGORIES,
  EMPLOYMENT_TYPE_LABELS,
  STAGE_LABELS,
  BOARD_STAGE_LABELS,
  RESULT_LABELS,
  EVENT_TYPE_LABELS,
  MATERIAL_KIND_LABELS,
  TODO_CATEGORY_LABELS,
  isValidEmail,
  isValidDate,
  isValidDateTime,
  isValidUrl,
  safeRedirectPath,
  parseId,
  calculateDday,
  normalizeTags,
  attachUiHelpers,
};
