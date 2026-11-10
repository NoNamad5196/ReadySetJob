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

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

function isValidDate(dateStr) {
  if (!dateStr) return true;
  if (typeof dateStr !== 'string' || !DATE_REGEX.test(dateStr.trim())) {
    return false;
  }
  const d = new Date(`${dateStr.trim()}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function isValidDateTime(dtStr) {
  if (typeof dtStr !== 'string' || !dtStr.trim()) {
    return false;
  }
  const d = new Date(dtStr.trim());
  return !Number.isNaN(d.getTime());
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

function calculateDday(deadlineStr) {
  if (!deadlineStr || !DATE_REGEX.test(deadlineStr)) {
    return { label: '상시/미정', state: 'none', days: null };
  }
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = deadlineStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  const diffDays = Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { label: 'D-Day', state: 'urgent', days: 0 };
  }
  if (diffDays > 0) {
    return {
      label: `D-${diffDays}`,
      state: diffDays <= 3 ? 'urgent' : diffDays <= 7 ? 'soon' : 'upcoming',
      days: diffDays,
    };
  }
  return { label: `마감 (D+${Math.abs(diffDays)})`, state: 'expired', days: diffDays };
}

function attachUiHelpers(req, res, next) {
  res.locals.EMPLOYMENT_TYPES = EMPLOYMENT_TYPES;
  res.locals.APPLICATION_STAGES = APPLICATION_STAGES;
  res.locals.APPLICATION_RESULTS = APPLICATION_RESULTS;
  res.locals.EVENT_TYPES = EVENT_TYPES;
  res.locals.EMPLOYMENT_TYPE_LABELS = EMPLOYMENT_TYPE_LABELS;
  res.locals.STAGE_LABELS = STAGE_LABELS;
  res.locals.BOARD_STAGE_LABELS = BOARD_STAGE_LABELS;
  res.locals.RESULT_LABELS = RESULT_LABELS;
  res.locals.EVENT_TYPE_LABELS = EVENT_TYPE_LABELS;
  res.locals.calculateDday = calculateDday;
  next();
}

module.exports = {
  EMPLOYMENT_TYPES,
  APPLICATION_STAGES,
  APPLICATION_RESULTS,
  EVENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  STAGE_LABELS,
  BOARD_STAGE_LABELS,
  RESULT_LABELS,
  EVENT_TYPE_LABELS,
  isValidEmail,
  isValidDate,
  isValidDateTime,
  isValidUrl,
  calculateDday,
  attachUiHelpers,
};
