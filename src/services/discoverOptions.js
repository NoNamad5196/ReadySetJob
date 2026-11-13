const PURPOSES = [
  { value: 'new_grad', label: '신입 취업', group: 'job', employmentType: 'new_grad', memoPrefix: '', orgLabel: '기업/직무', deadlineSuffix: '마감' },
  { value: 'experienced', label: '경력 이직', group: 'job', employmentType: 'experienced', memoPrefix: '', orgLabel: '기업/직무', deadlineSuffix: '마감' },
  { value: 'intern', label: '인턴', group: 'job', employmentType: 'intern', memoPrefix: '', orgLabel: '기업/직무', deadlineSuffix: '마감' },
  { value: 'parttime', label: '아르바이트', group: 'parttime', employmentType: 'other', memoPrefix: '[아르바이트]', orgLabel: '근무처/업무', deadlineSuffix: '마감' },
  { value: 'grad_school', label: '대학원', group: 'grad_school', employmentType: 'other', memoPrefix: '[대학원]', orgLabel: '학교/프로그램', deadlineSuffix: '원서 마감' },
];

const PURPOSE_MAP = Object.fromEntries(PURPOSES.map((p) => [p.value, p]));
const PURPOSE_VALUES = PURPOSES.map((p) => p.value);
const PURPOSE_LABELS = Object.fromEntries(PURPOSES.map((p) => [p.value, p.label]));
const EMPLOYMENT_TYPES = ['intern', 'new_grad', 'experienced', 'other'];
const ALLOWED_EMPLOYMENT_TYPES = Array.from(new Set([...EMPLOYMENT_TYPES, ...PURPOSE_VALUES]));

const FIELD_GROUPS = [
  {
    key: 'job',
    heading: '취업·인턴 분야',
    purposes: ['new_grad', 'experienced', 'intern'],
    options: [
      '프론트엔드', '백엔드', '앱(iOS·Android)', '데이터·AI', '게임', '보안·인프라',
      '디자인(UX/UI)', '기획·PM', '마케팅', '영업·고객', '경영·사무', '연구·R&D',
    ],
  },
  {
    key: 'parttime',
    heading: '아르바이트 분야',
    purposes: ['parttime'],
    options: [
      '카페·음료', '음식점·주방', '편의점·매장', '과외·학원 강사', '사무보조',
      '물류·배송', '행사·스태프', 'IT·코딩 알바', '교내 근로',
    ],
  },
  {
    key: 'grad_school',
    heading: '대학원 전공 계열',
    purposes: ['grad_school'],
    options: [
      '컴퓨터공학·소프트웨어', 'AI·데이터사이언스', '전자·전기', '기계·산업',
      '경영·경제', '디자인', '인문·사회', '자연과학', '의생명',
    ],
  },
];

const FIELDS_BY_GROUP = Object.fromEntries(FIELD_GROUPS.map((g) => [g.key, g.options]));
const FIELDS_BY_PURPOSE = Object.fromEntries(PURPOSES.map((p) => [p.value, FIELDS_BY_GROUP[p.group] || []]));

const DEGREES = ['석사', '박사', '석박통합'];
const REGIONS = ['서울', '경기', '인천', '부산', '대구', '대전', '광주', '원격·재택', '전국'];
const SCHEDULES = ['주말', '평일', '단기', '장기'];

const MAX_FIELDS_COUNT = 3;
const MAX_KEYWORD_LENGTH = 40;

const PURPOSE_SOURCES = {
  new_grad: '기업 공식 채용 페이지, 원티드, 사람인, 잡코리아, 잡플래닛, 링커리어(인턴)',
  experienced: '기업 공식 채용 페이지, 원티드, 사람인, 잡코리아, 잡플래닛, 링커리어(인턴)',
  intern: '기업 공식 채용 페이지, 원티드, 사람인, 잡코리아, 잡플래닛, 링커리어(인턴)',
  parttime: '알바몬, 알바천국, 학교 근로장학 공지',
  grad_school: '각 대학원 입학처 모집요강, 대학원 신입생 모집 공지',
};

function defaultDiscoverForm() {
  return {
    purpose: 'new_grad',
    purposes: ['new_grad'],
    employment_type: ['new_grad'],
    employment_types: ['new_grad'],
    fields: [],
    region: '서울',
    degree: '',
    schedule: '',
    keyword: '',
  };
}

function normalizeMultiValueInput(rawInput) {
  if (rawInput === undefined || rawInput === null) {
    return { provided: false, ok: true, values: [] };
  }
  if (typeof rawInput === 'string') {
    const parts = rawInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unique = Array.from(new Set(parts));
    return { provided: true, ok: unique.length > 0, values: unique };
  }
  if (Array.isArray(rawInput)) {
    if (rawInput.length === 0) {
      return { provided: true, ok: false, values: [] };
    }
    const values = [];
    for (const item of rawInput) {
      if (typeof item !== 'string') {
        return { provided: true, ok: false, values: [] };
      }
      const parts = item
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        return { provided: true, ok: false, values: [] };
      }
      for (const p of parts) {
        if (!values.includes(p)) values.push(p);
      }
    }
    return { provided: true, ok: values.length > 0, values };
  }
  return { provided: true, ok: false, values: [] };
}

function normalizeFieldsInput(rawFields) {
  if (rawFields === undefined || rawFields === null || rawFields === '') {
    return { ok: true, values: [] };
  }
  if (Array.isArray(rawFields)) {
    const values = [];
    for (const v of rawFields) {
      if (typeof v !== 'string') return { ok: false, values: [] };
      const trimmed = v.trim();
      if (!trimmed) return { ok: false, values: [] };
      values.push(trimmed);
    }
    return { ok: true, values };
  }
  if (typeof rawFields === 'string') {
    const trimmed = rawFields.trim();
    return { ok: true, values: trimmed ? [trimmed] : [] };
  }
  return { ok: false, values: [] };
}

function validateDiscoverInput(body = {}) {
  const raw = body && typeof body === 'object' ? body : {};
  const rawPurposeInput =
    raw.purpose !== undefined
      ? raw.purpose
      : raw['purpose[]'] !== undefined
        ? raw['purpose[]']
        : raw.purposes;
  const rawEmpInput =
    raw.employment_type !== undefined
      ? raw.employment_type
      : raw['employment_type[]'] !== undefined
        ? raw['employment_type[]']
        : raw.employment_types !== undefined
          ? raw.employment_types
          : raw.employmentType !== undefined
            ? raw.employmentType
            : raw.employmentTypes;

  const purposeParsed = normalizeMultiValueInput(rawPurposeInput);
  const empParsed = normalizeMultiValueInput(rawEmpInput);
  const fieldsResult = normalizeFieldsInput(raw.fields !== undefined ? raw.fields : raw['fields[]']);
  const rawFields = fieldsResult.values;
  const region = typeof raw.region === 'string' ? raw.region.trim() : '';
  const degree = typeof raw.degree === 'string' ? raw.degree.trim() : '';
  const schedule = typeof raw.schedule === 'string' ? raw.schedule.trim() : '';
  const keyword = typeof raw.keyword === 'string' ? raw.keyword.trim() : '';

  const validPurposesFromInput = purposeParsed.values.filter((p) => PURPOSE_VALUES.includes(p));
  const validEmpFromInput = empParsed.values.filter((e) => ALLOWED_EMPLOYMENT_TYPES.includes(e));
  const fallbackPurposes =
    validPurposesFromInput.length > 0
      ? validPurposesFromInput
      : validEmpFromInput.length > 0
        ? validEmpFromInput.map((e) => (PURPOSE_VALUES.includes(e) ? e : 'new_grad'))
        : ['new_grad'];

  const form = {
    purpose: fallbackPurposes[0] || 'new_grad',
    purposes: fallbackPurposes,
    employment_type: validEmpFromInput.length > 0 ? validEmpFromInput : fallbackPurposes,
    employment_types: validEmpFromInput.length > 0 ? validEmpFromInput : fallbackPurposes,
    fields: rawFields.slice(0, MAX_FIELDS_COUNT),
    region: REGIONS.includes(region) ? region : '서울',
    degree: DEGREES.includes(degree) ? degree : '',
    schedule: SCHEDULES.includes(schedule) ? schedule : '',
    keyword: keyword.slice(0, MAX_KEYWORD_LENGTH),
  };

  if (empParsed.provided) {
    if (!empParsed.ok || empParsed.values.some((v) => !ALLOWED_EMPLOYMENT_TYPES.includes(v))) {
      return { ok: false, error: '채용 형태를 1개 이상 올바르게 선택해 주세요.', form };
    }
  }

  if (purposeParsed.provided) {
    if (!purposeParsed.ok || purposeParsed.values.some((v) => !PURPOSE_VALUES.includes(v))) {
      return { ok: false, error: '찾으시는 목적(무엇을 찾나요?)을 올바르게 선택해 주세요.', form };
    }
  }

  if (!purposeParsed.provided && !empParsed.provided) {
    return { ok: false, error: '찾으시는 목적(무엇을 찾나요?)을 올바르게 선택해 주세요.', form };
  }

  const purposes = [];
  for (const p of purposeParsed.values) {
    if (PURPOSE_VALUES.includes(p) && !purposes.includes(p)) purposes.push(p);
  }
  for (const e of empParsed.values) {
    const mappedPurpose = PURPOSE_VALUES.includes(e) ? e : 'new_grad';
    if (!purposes.includes(mappedPurpose)) purposes.push(mappedPurpose);
  }

  const employmentTypes = [];
  if (empParsed.provided) {
    for (const e of empParsed.values) {
      const mappedEmp = PURPOSE_MAP[e] ? PURPOSE_MAP[e].employmentType : e;
      if (!employmentTypes.includes(mappedEmp)) employmentTypes.push(mappedEmp);
    }
  }
  for (const p of purposes) {
    const mappedEmp = PURPOSE_MAP[p] ? PURPOSE_MAP[p].employmentType : 'other';
    if (!employmentTypes.includes(mappedEmp)) employmentTypes.push(mappedEmp);
  }

  const allowedFieldsSet = new Set();
  for (const p of purposes) {
    for (const f of FIELDS_BY_PURPOSE[p] || []) {
      allowedFieldsSet.add(f);
    }
  }
  const allowedFields = Array.from(allowedFieldsSet);

  if (!fieldsResult.ok || rawFields.length < 1) {
    return { ok: false, error: '분야를 1개 이상 선택해 주세요 (최대 3개).', form };
  }
  if (rawFields.length > MAX_FIELDS_COUNT) {
    return { ok: false, error: '분야는 최대 3개까지 선택할 수 있습니다.', form };
  }

  const uniqueFields = [];
  for (const f of rawFields) {
    if (!allowedFields.includes(f)) {
      return { ok: false, error: '선택한 목적에 맞지 않거나 허용되지 않은 분야가 포함되어 있습니다.', form };
    }
    if (!uniqueFields.includes(f)) uniqueFields.push(f);
  }

  if (!region || !REGIONS.includes(region)) {
    return { ok: false, error: '지역을 올바르게 선택해 주세요.', form };
  }
  if ((raw.degree !== undefined && raw.degree !== null && typeof raw.degree !== 'string') || (degree && !DEGREES.includes(degree))) {
    return { ok: false, error: '올바른 학위 과정을 선택해 주세요.', form };
  }
  if ((raw.schedule !== undefined && raw.schedule !== null && typeof raw.schedule !== 'string') || (schedule && !SCHEDULES.includes(schedule))) {
    return { ok: false, error: '올바른 근무 형태를 선택해 주세요.', form };
  }
  if (raw.keyword !== undefined && raw.keyword !== null && typeof raw.keyword !== 'string') {
    return { ok: false, error: '추가 키워드 형식이 올바르지 않습니다.', form };
  }
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return { ok: false, error: `추가 키워드는 ${MAX_KEYWORD_LENGTH}자 이하로 입력해 주세요.`, form };
  }

  const primaryPurpose = purposes[0];
  const normalized = {
    purpose: primaryPurpose,
    purposes,
    employment_type: employmentTypes,
    employment_types: employmentTypes,
    fields: uniqueFields,
    region,
    degree: purposes.includes('grad_school') ? degree : '',
    schedule: purposes.includes('parttime') ? schedule : '',
    keyword,
  };
  return { ok: true, value: normalized, form: normalized };
}

module.exports = {
  PURPOSES,
  PURPOSE_MAP,
  PURPOSE_VALUES,
  PURPOSE_LABELS,
  EMPLOYMENT_TYPES,
  ALLOWED_EMPLOYMENT_TYPES,
  FIELD_GROUPS,
  FIELDS_BY_GROUP,
  FIELDS_BY_PURPOSE,
  DEGREES,
  REGIONS,
  SCHEDULES,
  MAX_FIELDS_COUNT,
  MAX_KEYWORD_LENGTH,
  PURPOSE_SOURCES,
  defaultDiscoverForm,
  normalizeMultiValueInput,
  validateDiscoverInput,
};
