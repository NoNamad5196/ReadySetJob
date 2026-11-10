class AiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.expose = true;
  }
}

let customFetch = null;

function setFetchImpl(fn) {
  customFetch = fn;
}

function getFetchImpl(overrideFn) {
  return overrideFn || customFetch || globalThis.fetch;
}

function isAiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// In-memory per-user rate limiter: max 5 generations per 10 minutes per user
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_GENERATIONS = 5;
const userGenerations = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const uid = String(userId);
  const timestamps = (userGenerations.get(uid) || []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );

  if (timestamps.length >= MAX_GENERATIONS) {
    return {
      allowed: false,
      message: '면접 질문 생성 요청 한도를 초과했습니다 (10분당 최대 5회). 잠시 후 다시 시도해 주세요.',
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

async function generateInterviewQuestions(
  { jobTitle = '', position = '', companyName = '', jobMemo = '', essayAnswers = [] } = {},
  options = {}
) {
  if (!isAiEnabled()) {
    throw new AiError('AI 기능이 비활성화되어 있습니다 (GEMINI_API_KEY 미설정)', 503);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Truncate inputs defensively (essays total <= 6000 chars)
  let essaysText = '';
  if (Array.isArray(essayAnswers)) {
    essaysText = essayAnswers
      .map((a, idx) => `[답변 ${idx + 1}]\n${String(a || '').trim()}`)
      .filter((s) => s.length > 0)
      .join('\n\n');
  } else if (typeof essayAnswers === 'string') {
    essaysText = essayAnswers.trim();
  }

  if (essaysText.length > 6000) {
    essaysText = essaysText.slice(0, 6000);
  }

  const truncatedCompany = String(companyName || '').slice(0, 200);
  const truncatedJobTitle = String(jobTitle || '').slice(0, 200);
  const truncatedPosition = String(position || '').slice(0, 200);
  const truncatedMemo = String(jobMemo || '').slice(0, 2000);

  const promptText = `당신은 전문 채용 면접관입니다. 다음 지원자의 채용 공고 정보와 자기소개서 답변을 바탕으로 실제 면접에서 나올 수 있는 한국어 예상 면접 질문을 5~8개 생성해 주세요.

[지원 정보]
- 회사명: ${truncatedCompany || '미지정'}
- 공고명: ${truncatedJobTitle || '미지정'}
- 직무: ${truncatedPosition || '미지정'}
- 메모/특이사항: ${truncatedMemo || '없음'}

[자기소개서 내용]
${essaysText || '등록된 자기소개서 내용 없음'}

[지침]
1. 지원 기업, 직무, 자기소개서 답변에 구체적으로 근거한 질문이어야 합니다.
2. 질문은 자연스러운 한국어 문장으로 작성해 주세요.
3. 응답은 반드시 5~8개의 질문 문자열로만 구성된 JSON 배열 형식이어야 합니다.
예: ["질문 1", "질문 2", "질문 3", "질문 4", "질문 5"]`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: promptText,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const fetchFn = getFetchImpl(options.fetchImpl);

  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      throw new AiError('AI 요청 시간이 초과되었습니다 (15초). 잠시 후 다시 시도해 주세요.', 504);
    }
    throw new AiError('AI 서비스 연결에 실패했습니다. 네트워크 상태를 확인해 주세요.', 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new AiError('AI 서비스 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.', 429);
    }
    if (res.status >= 400 && res.status < 500) {
      throw new AiError('AI 서비스 요청 처리 중 오류가 발생했습니다.', res.status);
    }
    if (res.status >= 500) {
      throw new AiError('AI 서비스 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 502);
    }
    throw new AiError('AI 서비스 응답 오류가 발생했습니다.', res.status || 500);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new AiError('AI 응답을 JSON으로 파싱할 수 없습니다.', 502);
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText || typeof rawText !== 'string') {
    throw new AiError('AI 응답에서 생성된 내용을 찾을 수 없습니다.', 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    throw new AiError('AI 응답이 유효한 JSON 형식이 아닙니다.', 502);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AiError('AI 응답이 올바른 면접 질문 배열 형식이 아닙니다.', 502);
  }

  const validQuestions = [];
  for (const item of parsed) {
    if (typeof item !== 'string') {
      throw new AiError('AI 응답에 유효하지 않은 질문 항목이 포함되어 있습니다.', 502);
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 500) {
      throw new AiError('AI 응답에 길이가 유효하지 않은 질문이 포함되어 있습니다 (1~500자).', 502);
    }
    validQuestions.push(trimmed);
    if (validQuestions.length === 10) {
      break;
    }
  }

  if (validQuestions.length === 0) {
    throw new AiError('생성된 면접 질문이 없습니다.', 502);
  }

  return validQuestions;
}

module.exports = {
  AiError,
  isAiEnabled,
  setFetchImpl,
  getFetchImpl,
  checkRateLimit,
  resetRateLimit,
  generateInterviewQuestions,
};
