const {
  INTERVIEW_QUESTIONS_SCHEMA,
  ESSAY_FEEDBACK_SCHEMA,
  STAR_DRAFT_SCHEMA,
  JOB_PARSE_SCHEMA,
  ESSAY_QUESTIONS_EXTRACT_SCHEMA,
  buildInterviewPrompt,
  validateInterviewOutput,
  buildFeedbackPrompt,
  validateFeedbackOutput,
  buildStarDraftPrompt,
  validateStarDraftOutput,
  buildJobParsePrompt,
  validateJobParseOutput,
  buildEssayQuestionsPrompt,
  validateEssayQuestionsOutput,
  JOB_SEARCH_SCHEMA,
  WEEKLY_BRIEFING_SCHEMA,
  buildJobSearchPrompt,
  validateJobSearchOutput,
  buildBriefingPrompt,
  validateBriefingOutput,
  isHttpUrl,
} = require('./aiSchemas');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const AI_DISABLED_MESSAGE = 'AI 기능을 지금은 사용할 수 없습니다';
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
  search: {
    label: 'AI 공고 검색·추천 (웹 검색)',
    envVar: 'OPENAI_MODEL_SEARCH',
    defaultModel: 'gpt-6.1-terra',
    effort: 'low',
    schemaName: 'job_search_results',
    schema: JOB_SEARCH_SCHEMA,
    maxOutputTokens: 6000,
    timeoutMs: 90000,
    // Hosted Responses API web search tool; tool_choice "required" forces at least one search.
    tools: [
      {
        type: 'web_search',
        search_context_size: 'medium',
        user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' },
      },
    ],
    toolChoice: 'required',
    include: ['web_search_call.action.sources'],
  },
  briefing: {
    label: 'AI 주간 브리핑',
    envVar: 'OPENAI_MODEL_BRIEFING',
    defaultModel: 'gpt-6-luna',
    effort: 'low',
    schemaName: 'weekly_briefing',
    schema: WEEKLY_BRIEFING_SCHEMA,
    maxOutputTokens: 1600,
  },
  essay_questions: {
    label: '자기소개서 문항 자동 추출',
    envVar: 'OPENAI_MODEL_EXTRACT',
    defaultModel: 'gpt-6-luna',
    effort: 'none',
    schemaName: 'essay_questions_extract',
    schema: ESSAY_QUESTIONS_EXTRACT_SCHEMA,
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
  const models = {};
  for (const key of Object.keys(FEATURE_SPECS)) {
    models[key] = getFeatureModel(key);
  }
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
  if (Array.isArray(spec.tools) && spec.tools.length > 0) {
    requestBody.tools = spec.tools;
    if (spec.toolChoice) requestBody.tool_choice = spec.toolChoice;
    if (Array.isArray(spec.include) && spec.include.length > 0) requestBody.include = spec.include;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), spec.timeoutMs || REQUEST_TIMEOUT_MS);
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

  if (data.status && data.status !== 'completed') {
    throw createAiError('AI 응답이 완료되지 않았습니다 (길이 제한 또는 안전 필터).', 502);
  }

  const rawText = extractResponseText(data);
  const parsed = parseJsonLoose(rawText);
  if (parsed === undefined) {
    throw createAiError('AI 응답이 유효한 JSON 형식이 아닙니다.', 502);
  }

  const consultedUrls = extractConsultedSourceUrls(data);
  return {
    parsed,
    model,
    citations: extractUrlCitations(data),
    webSearchUsed: hasCompletedWebSearch(data),
    consultedUrls,
  };
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : String(text);
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function extractUrlCitations(data) {
  const citations = [];
  const seen = new Set();
  const outputItems = data && Array.isArray(data.output) ? data.output : [];
  for (const item of outputItems) {
    const parts = item && Array.isArray(item.content) ? item.content : [];
    for (const part of parts) {
      const annotations = part && Array.isArray(part.annotations) ? part.annotations : [];
      for (const ann of annotations) {
        if (!ann || ann.type !== 'url_citation' || typeof ann.url !== 'string') continue;
        const url = ann.url.trim();
        if (!isHttpUrl(url) || seen.has(url)) continue;
        seen.add(url);
        citations.push({ url, title: typeof ann.title === 'string' ? ann.title.trim().slice(0, 200) : '' });
      }
    }
  }
  return citations.slice(0, 10);
}

function hasCompletedWebSearch(data) {
  const output = data && Array.isArray(data.output) ? data.output : [];
  return output.some((item) => item && item.type === 'web_search_call' && item.status === 'completed');
}

function extractConsultedSourceUrls(data) {
  const output = data && Array.isArray(data.output) ? data.output : [];
  const urls = [];
  const seen = new Set();
  for (const item of output) {
    if (!item || item.type !== 'web_search_call' || item.status !== 'completed') continue;
    const action = item.action || {};
    const sources = Array.isArray(action.sources) ? action.sources : [];
    for (const source of sources) {
      const url = source && typeof source.url === 'string' ? source.url.trim() : '';
      if (!isHttpUrl(url) || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
    if (action.type === 'open_page' && typeof action.url === 'string') {
      const url = action.url.trim();
      if (isHttpUrl(url) && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
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

async function extractEssayQuestions(payload = {}, options = {}) {
  const { instructions, input } = buildEssayQuestionsPrompt(payload);
  const { parsed, model } = await callOpenAiStructured({
    featureKey: 'essay_questions',
    instructions,
    input,
    fetchImpl: options.fetchImpl,
  });
  const result = validateEssayQuestionsOutput(parsed, createAiError);
  return { result, questions: result.questions, essay_questions: result.questions, model };
}

async function searchJobPostings(payload = {}, options = {}) {
  const now = options.now || new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const { instructions, input } = buildJobSearchPrompt({ ...payload, today });
  const { parsed, model, citations, webSearchUsed, consultedUrls } = await callOpenAiStructured({
    featureKey: 'search',
    instructions,
    input,
    fetchImpl: options.fetchImpl,
  });
  if (!webSearchUsed) {
    throw createAiError('AI 응답에서 완료된 웹 검색을 확인할 수 없습니다.', 502);
  }
  const validationOptions = {
    purpose: payload.purpose,
    purposes: payload.purposes,
    employment_type: payload.employment_type,
  };
  if (consultedUrls.length > 0) validationOptions.sourceUrls = consultedUrls;
  const { results } = validateJobSearchOutput(parsed, createAiError, validationOptions);
  return { results, citations, model };
}

async function generateWeeklyBriefing(context = {}, options = {}) {
  const { instructions, input } = buildBriefingPrompt(context);
  const { parsed, model } = await callOpenAiStructured({
    featureKey: 'briefing',
    instructions,
    input,
    fetchImpl: options.fetchImpl,
  });
  const result = validateBriefingOutput(parsed, createAiError, { allowedHrefs: options.allowedHrefs });
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
  extractEssayQuestions,
  searchJobPostings,
  generateWeeklyBriefing,
};
