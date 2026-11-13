const { isRecord } = require('./common');

const KINDS = [
  { value: 'certificate', label: '자격증' }, { value: 'bootcamp', label: '부트캠프·교육' },
  { value: 'contest', label: '공모전' }, { value: 'activity', label: '대외활동' },
  { value: 'grad_school', label: '대학원' }, { value: 'private_certificate', label: '민간자격(어학·데이터)' },
  { value: 'public_job', label: '공공기관 채용' },
];
const KIND_LABELS = Object.fromEntries(KINDS.map((kind) => [kind.value, kind.label]));
const ACTIVITY_FIELDS = ['IT·SW', '디자인', '마케팅·광고', '기획·아이디어', '영상·사진', '문학·글', '학술·논문', '창업', '봉사', '서포터즈·기자단'];
const GRAD_FIELDS = ['컴퓨터공학·소프트웨어', 'AI·데이터사이언스', '전자·전기', '기계·산업', '경영·경제', '디자인', '인문·사회', '자연과학', '의생명'];
const BOOTCAMP_FIELDS = [{ value: '20', label: '정보통신' }, { value: '02', label: '경영·회계·사무' }, { value: '08', label: '문화·예술·디자인' }];
const REGIONS = [
  { value: '', label: '전국' }, { value: '11', label: '서울' }, { value: '41', label: '경기' },
  { value: '28', label: '인천' }, { value: '26', label: '부산' }, { value: '27', label: '대구' },
  { value: '30', label: '대전' }, { value: '29', label: '광주' },
];
const DEGREES = ['석사', '박사', '석박통합'];
const PRIVATE_CERTS = ['TOEIC', 'OPIc', 'SQLD', 'ADsP'];
const PERIODS = ['1', '3', '6'];
const TRACKS = ['C0104', 'C0105', 'C0061'];
const MAX_KEYWORD_LENGTH = 40;
const MAX_FIELDS_COUNT = 3;
const SOURCES = ['qnet', 'dataq', 'alio', 'work24', 'ai_verified'];

function currentYear() { return new Date().getFullYear(); }
function defaultDiscoverForm() {
  return { kind: 'certificate', cert_code: '1320', year: String(currentYear()), keyword: '', fields: [],
    region: '', months: '3', degree: '', private_cert: 'TOEIC', ncs: '20', track: 'C0104', mode: 'search', source: '' };
}

function validateDiscoverInput(body = {}) {
  const raw = isRecord(body) ? body : {};
  const form = defaultDiscoverForm();
  const keys = ['kind', 'cert_code', 'year', 'keyword', 'region', 'months', 'degree', 'private_cert', 'ncs', 'track', 'mode', 'source'];
  for (const key of keys) if (typeof raw[key] === 'string') form[key] = raw[key].trim().slice(0, key === 'keyword' ? 40 : 80);
  const fail = (error) => ({ ok: false, error, form });
  if (!isRecord(body)) return fail('검색 조건 형식이 올바르지 않습니다.');
  if (keys.some((key) => raw[key] != null && typeof raw[key] !== 'string')) return fail('검색 조건 형식이 올바르지 않습니다.');
  if (!Object.hasOwn(KIND_LABELS, form.kind)) return fail('스펙 종류를 올바르게 선택해 주세요.');
  if (!['search', 'catalog'].includes(form.mode) || (form.mode === 'catalog' && form.kind !== 'certificate')) return fail('검색 방식을 올바르게 선택해 주세요.');
  if (form.source && !SOURCES.includes(form.source)) return fail('데이터 소스를 올바르게 선택해 주세요.');
  const compatible = { certificate: ['qnet'], bootcamp: ['work24', 'ai_verified'], private_certificate: ['dataq', 'ai_verified'],
    contest: ['ai_verified'], activity: ['ai_verified'], grad_school: ['ai_verified'], public_job: ['alio'] };
  if (form.source && !compatible[form.kind].includes(form.source)) return fail('선택한 종류에 맞는 데이터 소스를 선택해 주세요.');
  if (raw.keyword && (raw.keyword.trim().length > MAX_KEYWORD_LENGTH || /[\x00-\x1f\x7f]/.test(raw.keyword))) return fail('추가 키워드는 40자 이하의 일반 텍스트로 입력해 주세요.');
  const fieldKey = form.kind === 'grad_school' ? 'grad_fields' : 'activity_fields';
  const fieldInput = raw.fields !== undefined ? raw.fields : raw[fieldKey];
  const fields = fieldInput == null || fieldInput === '' ? [] : Array.isArray(fieldInput) ? fieldInput : [fieldInput];
  const allowed = form.kind === 'grad_school' ? GRAD_FIELDS : ['contest', 'activity'].includes(form.kind) ? ACTIVITY_FIELDS : [];
  if (fields.some((field) => typeof field !== 'string') || fields.length > MAX_FIELDS_COUNT) return fail('분야는 올바른 값으로 최대 3개까지 선택해 주세요.');
  form.fields = [...new Set(fields.map((field) => field.trim()))];
  if (form.fields.some((field) => !allowed.includes(field))) return fail('선택한 종류에 맞는 분야를 선택해 주세요.');
  if (['contest', 'activity', 'grad_school'].includes(form.kind) && !form.fields.length) return fail('분야를 1개 이상 선택해 주세요.');
  if (!REGIONS.some((region) => region.value === form.region)) return fail('지역을 올바르게 선택해 주세요.');
  if (!PERIODS.includes(form.months)) return fail('시작 기간을 1·3·6개월 중 선택해 주세요.');
  if (form.degree && !DEGREES.includes(form.degree)) return fail('학위를 올바르게 선택해 주세요.');
  if (!PRIVATE_CERTS.includes(form.private_cert)) return fail('민간자격을 올바르게 선택해 주세요.');
  if (!BOOTCAMP_FIELDS.some((field) => field.value === form.ncs) || !TRACKS.includes(form.track)) return fail('교육 분야와 훈련 유형을 올바르게 선택해 주세요.');
  const year = Number(form.year);
  if (!/^\d{4}$/.test(form.year) || year < currentYear() - 1 || year > currentYear() + 2) return fail('조회 연도를 올바르게 선택해 주세요.');
  if (form.kind === 'certificate' && form.mode !== 'catalog' && !/^\d{1,8}$/.test(form.cert_code)) return fail('카탈로그에서 자격증을 선택해 주세요.');
  return { ok: true, value: form, form };
}

module.exports = {
  KINDS, KIND_LABELS, ACTIVITY_FIELDS, GRAD_FIELDS, BOOTCAMP_FIELDS, REGIONS, DEGREES,
  PRIVATE_CERTS, PERIODS, TRACKS, MAX_KEYWORD_LENGTH, MAX_FIELDS_COUNT, SOURCES,
  currentYear, defaultDiscoverForm, validateDiscoverInput,
};
