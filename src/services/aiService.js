const {
  INTERVIEW_QUESTIONS_SCHEMA,
  ESSAY_FEEDBACK_SCHEMA,
  STAR_DRAFT_SCHEMA,
  JOB_PARSE_SCHEMA,
  buildInterviewPrompt,
  validateInterviewOutput,
  buildFeedbackPrompt,
  validateFeedbackOutput,
  buildStarDraftPrompt,
  validateStarDraftOutput,
  buildJobParsePrompt,
  validateJobParseOutput,
} = require('./aiSchemas');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const AI_DISABLED_MESSAGE = 'AI 기능이 비활성화되어 있습니다 (OPENAI_API_KEY 미설정)';
const REQUEST_TIMEOUT_MS = 25000;

const FEATURE_SPECS = {
  interview: {
    label: '면접 예상 질문 생성',
    envVar: 'OPENAI_MODEL_INTERVIEW',
    defaultModel: 'gpt-6.1-terra',
    effort: 'low',
    schemaName: 'interview_questions',
    schema: INTERVIEW_QUESTIONS_SCHEMA,
    maxOutputTokens: 1200,
  },
  feedback: {
    label: '자기소개서 문항 피드백',
    envVar: 'OPENAI_MODEL_FEEDBACK',
    defaultModel: 'gpt-6.1-terra',
    effort: 'medium',
    schemaName: 'essay_feedback',
    schema: ESSAY_FEEDBACK_SCHEMA,
    maxOutputTokens: 1600,
  },
  draft: {
    label: '경험 자료 STAR 초안 생성',
    envVar: 'OPENAI_MODEL_DRAFT',
    defaultModel: 'gpt-6.1-terra',
    effort: 'low',
    schemaName: 'material_star_draft',
    schema: STAR_DRAFT_SCHEMA,
    maxOutputTokens: 1400,
  },
  extract: {
    label: '채용 공고 텍스트 자동 추출',
    envVar: 'OPENAI_MODEL_EXTRACT',
    defaultModel: 'gpt-6-luna',
    effort: 'none',
    schemaName: 'job_post_extract',
    schema: JOB_PARSE_SCHEMA,
    maxOutputTokens: 1200,
  },
};

class AiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.expose = true;
  }
}

function createAiError(message, status = 502) {
  return new AiError(message, status);
}

let customFetch = null;

function setFetchImpl(fn) {
  customFetch = fn;
}

function getFetchImpl(overrideFn) {
  return overrideFn || customFetch || globalThis.fetch;
}

function isAiEnabled() {
  return Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim());
}

function getFeatureModel(featureKey) {
  const globalEnv = String(process.env.OPENAI_MODEL || '').trim();
  if (globalEnv) return globalEnv;
  const spec = FEATURE_SPECS[featureKey];
  if (!spec) return 'gpt-6.1-terra';
  const featureEnv = String(process.env[spec.envVar] || '').trim();
  return featureEnv || spec.defaultModel;
}

function getAiConfig() {
  const models = {
    interview: getFeatureModel('interview'),
    feedback: getFeatureModel('feedback'),
    draft: getFeatureModel('draft'),
    extract: getFeatureModel('extract'),
  };
  const features = Object.entries(FEATURE_SPECS).map(([key, spec]) => ({
    key,
    label: spec.label,
    envVar: spec.envVar,
    model: models[key],
    defaultModel: spec.defaultModel,
    effort: spec.effort,
  }));
  return {
    enabled: isAiEnabled(),
    ...models,
    models,
    features,
  };
}

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const userGenerations = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const uid = String(userId);
  const timestamps = (userGenerations.get(uid) || []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      message: `AI 기능 요청 한도를 초과했습니다 (10분당 최대 ${RATE_LIMIT_MAX}회). 잠시 후 다시 시도해 주세요.`,
    };
  }
  timestamps.push(now);
  userGenerations.set(uid, timestamps);
  return { allowed: true };
}

function resetRateLimit(userId) {
  if (userId !== undefined) {
    userGenerations.delete(String(userId));
  } else {
    userGenerations.clear();
  }
}

function extractResponseText(data) {
  if (!data || typeof data !== 'object') {
    throw createAiError('AI 응답에서 생성된 내용을 찾을 수 없습니다.', 502);
  }
  if (data.status === 'incomplete') {
    throw createAiError('AI 응답이 완료되지 않았습니다 (길이 제한 또는 안전 필터).', 502);
  }
  if (typeof data.refusal === 'string' && data.refusal.trim().length > 0) {
    throw createAiError('AI 안전 정책에 의해 요청이 거부되었습니다.', 502);
  }
  const outputItems = Array.isArray(data.output) ? data.output : [];
  const textParts = [];
  for (const item of outputItems) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'refusal' || (typeof item.refusal === 'string' && item.refusal.trim().length > 0)) {
      throw createAiError('AI 안전 정책에 의해 요청이 거부되었습니다.', 502);
    }
    if (item.type === 'output_text' && typeof item.text === 'string') {
      textParts.push(item.text);
    }
    const contentArr = Array.isArray(item.content) ? item.content : [];
    for (const part of contentArr) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'refusal' || (typeof part.refusal === 'string' && part.refusal.trim().length > 0)) {
        throw createAiError('AI 안전 정책에 의해 요청이 거부되었습니다.', 502);
      }
      if (part.type === 'output_text' && typeof part.text === 'string') {
        textParts.push(part.text);
      }
    }
  }
  if (typeof data.output_text === 'string' && data.output_text.trim().length > 0) {
    return data.output_text.trim();
  }
  const combined = textParts.join('').trim();
  if (!combined) {
    throw createAiError('AI 응답에서 생성된 내용을 찾을 수 없습니다.', 502);
  }
  return combined;
}

async function callOpenAiStructured({ featureKey, instructions, input, fetchImpl }) {
  if (!isAiEnabled()) {
    throw createAiError(AI_DISABLED_MESSAGE, 503);
  }
  const spec = FEATURE_SPECS[featureKey];
  const model = getFeatureModel(featureKey);
  const apiKey = String(process.env.OPENAI_API_KEY).trim();

  const requestBody = {
    model,
    instructions,
    input,
    reasoning: { effort: spec.effort },
    text: {
      format: {
        type: 'json_schema',
        name: spec.schemaName,
        strict: true,
        schema: spec.schema,
      },
    },
    max_output_tokens: spec.maxOutputTokens,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const fn = getFetchImpl(fetchImpl);

  let res;
  try {
    res = await fn(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      throw createAiError('AI 서버 응답이 지연되고 있습니다', 504);
    }
    throw createAiError('AI 서버 응답이 지연되고 있습니다', 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw createAiError('API 키가 올바르지 않습니다', 401);
    }
    if (res.status === 429) {
      throw createAiError('요청이 많거나 사용 한도를 초과했습니다', 429);
    }
    if (res.status >= 500) {
      throw createAiError('AI 서버 응답이 지연되고 있습니다', 502);
    }
    throw createAiError('AI 요청 처리 중 오류가 발생했습니다.', res.status || 502);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw createAiError('AI 응답을 JSON으로 파싱할 수 없습니다.', 502);
  }

  const rawText = extractResponseText(data);
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw createAiError('AI 응답이 유효한 JSON 형식이 아닙니다.', 502);
  }

  return { parsed, model };
}

async function generateInterviewQuestions(payload = {}, options = {}) {
  const { instructions, input } = buildInterviewPrompt(payload);
  const { parsed } = await callOpenAiStructured({
    featureKey: 'interview',
    instructions,
    input,
    fetchImpl: options.fetchImpl,
  });
  return validateInterviewOutput(parsed, createAiError);
}

async function generateEssayFeedback(payload = {}, options = {}) {
  const { instructions, input } = buildFeedbackPrompt(payload);
  const { parsed, model } = await callOpenAiStructured({
    featureKey: 'feedback',
    instructions,
    input,
    fetchImpl: options.fetchImpl,
  });
  const result = validateFeedbackOutput(parsed, createAiError);
  return { result, model };
}

async function generateMaterialStarDraft(payload = {}, options = {}) {
  const { instructions, input } = buildStarDraftPrompt(payload);
  const { parsed, model } = await callOpenAiStructured({
    featureKey: 'draft',
    instructions,
    input,
    fetchImpl: options.fetchImpl,
  });
  const result = validateStarDraftOutput(parsed, createAiError);
  return { result, model };
}

async function parseJobPostingText(payload = {}, options = {}) {
  const { instructions, input } = buildJobParsePrompt(payload);
  const { parsed, model } = await callOpenAiStructured({
    featureKey: 'extract',
    instructions,
    input,
    fetchImpl: options.fetchImpl,
  });
  const result = validateJobParseOutput(parsed, createAiError);
  return { result, model };
}

module.exports = {
  AI_DISABLED_MESSAGE,
  RATE_LIMIT_MAX,
  AiError,
  isAiEnabled,
  getFeatureModel,
  getAiConfig,
  setFetchImpl,
  getFetchImpl,
  checkRateLimit,
  resetRateLimit,
  generateInterviewQuestions,
  generateEssayFeedback,
  generateMaterialStarDraft,
  parseJobPostingText,
};
