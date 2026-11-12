// Auto-organize + auto-feedback automation.
// Sync DB side effects (todos/events) are idempotent: the same
// (user_id, application_id, title) todo or (user_id, title, type) event is
// never inserted twice. AI side effects run in the background via
// runInBackground() and never block or fail the HTTP response.

const { STAGE_LABELS } = require('../middleware/validation');
const { isAiEnabled, checkRateLimit, generateEssayFeedback } = require('./aiService');
const { getOwnedEssayQuestionContext, saveEssayFeedback } = require('./aiFeaturesService');
const { getApplicationById } = require('./applicationsService');
const { countAiQuestions, generateAiQuestionsForApplication } = require('./interviewQuestionsService');
const { runInBackground } = require('./backgroundTasks');

const INTERVIEW_STAGES = ['interview1', 'interview2'];
const MIN_AI_QUESTIONS = 3;
const DEADLINE_TIME = '18:00';
const TODO_TITLE_MAX = 120;
const ANSWER_MAX = 5000;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function deadlineEventTitle(companyName, jobTitle) {
  return `[${companyName}] ${jobTitle} 서류 마감`;
}

// Returns true when a new todo row was inserted.
function ensureTodo(db, userId, { applicationId, title, category, dueDate = null }) {
  const safeTitle = clip(title, TODO_TITLE_MAX);
  const existing = db
    .prepare('SELECT id FROM todos WHERE user_id = ? AND application_id = ? AND title = ?')
    .get(userId, applicationId, safeTitle);
  if (existing) return false;
  db.prepare('INSERT INTO todos (user_id, application_id, title, category, due_date) VALUES (?, ?, ?, ?, ?)')
    .run(userId, applicationId, safeTitle, category, dueDate || null);
  return true;
}

// Deadline events may exist before the application (created on job post
// registration with application_id NULL). When the application is created the
// orphan event is linked instead of duplicated. Returns true when inserted or linked.
function ensureDeadlineEvent(db, userId, { applicationId = null, title, deadline }) {
  const existing = db
    .prepare(`
      SELECT id, application_id FROM events
      WHERE user_id = ? AND type = 'deadline' AND title = ?
        AND (application_id IS NULL OR application_id = ?)
      ORDER BY application_id IS NULL ASC, id ASC LIMIT 1
    `)
    .get(userId, title, applicationId);
  if (existing) {
    if (applicationId && existing.application_id === null) {
      db.prepare('UPDATE events SET application_id = ? WHERE id = ? AND user_id = ?')
        .run(applicationId, existing.id, userId);
      return true;
    }
    return false;
  }
  db.prepare("INSERT INTO events (user_id, application_id, title, type, starts_at, memo) VALUES (?, ?, ?, 'deadline', ?, ?)")
    .run(userId, applicationId, title, `${deadline}T${DEADLINE_TIME}`, '자동 등록된 서류 마감 일정');
  return true;
}

function onJobCreated(db, userId, job) {
  const uid = Number(userId);
  if (!job || !job.deadline) return { eventCreated: false };
  return db.transaction(() => ({
    eventCreated: ensureDeadlineEvent(db, uid, {
      title: deadlineEventTitle(job.company_name, job.title),
      deadline: job.deadline,
    }),
  }))();
}

function applyStageAutomation(db, uid, application) {
  if (!INTERVIEW_STAGES.includes(application.stage)) return false;
  return ensureTodo(db, uid, {
    applicationId: application.id,
    title: `[${application.company_name}] ${STAGE_LABELS[application.stage]} 준비`,
    category: 'interview',
  });
}

// Sync part only; call scheduleStageAi() after the surrounding transaction commits.
function onApplicationCreated(db, userId, application) {
  const uid = Number(userId);
  return db.transaction(() => {
    let eventCreated = false;
    if (application.job_deadline) {
      eventCreated = ensureDeadlineEvent(db, uid, {
        applicationId: application.id,
        title: deadlineEventTitle(application.company_name, application.job_title),
        deadline: application.job_deadline,
      });
    }
    const essayTodoCreated = ensureTodo(db, uid, {
      applicationId: application.id,
      title: `[${application.company_name}] 자기소개서 작성`,
      category: 'essay',
      dueDate: application.job_deadline,
    });
    const stageTodoCreated = applyStageAutomation(db, uid, application);
    return { eventCreated, todoCreated: essayTodoCreated || stageTodoCreated };
  })();
}

// Background AI interview-question generation. Returns the tracked promise or
// null when skipped (AI disabled, enough questions, or rate limit reached).
function scheduleStageAi(db, userId, applicationId) {
  const uid = Number(userId);
  if (!isAiEnabled()) return null;
  const application = getApplicationById(db, uid, applicationId);
  if (!application || !INTERVIEW_STAGES.includes(application.stage)) return null;
  if (countAiQuestions(db, uid, application.id) >= MIN_AI_QUESTIONS) return null;
  if (!checkRateLimit(uid).allowed) return null;
  return runInBackground('interview-questions', async () => {
    if (!db.open) return;
    await generateAiQuestionsForApplication(db, uid, application);
  });
}

// Call after any stage change (PUT form, PATCH API, POST no-JS board form).
function onStageChanged(db, userId, application, previousStage) {
  if (!application || application.stage === previousStage) return { todoCreated: false };
  const uid = Number(userId);
  const todoCreated = db.transaction(() => applyStageAutomation(db, uid, application))();
  scheduleStageAi(db, uid, application.id);
  return { todoCreated };
}

function isAutoFeedbackOn(db, userId) {
  const row = db.prepare('SELECT auto_feedback FROM users WHERE id = ?').get(Number(userId));
  return Boolean(row && Number(row.auto_feedback) === 1);
}

async function generateFeedbackForQuestions(db, uid, essayId, questionIds) {
  for (const questionId of questionIds) {
    if (!db.open) return;
    const ctx = getOwnedEssayQuestionContext(db, uid, essayId, questionId);
    const answer = ctx ? String(ctx.answer || '').trim() : '';
    if (!answer || answer.length > ANSWER_MAX) continue;
    if (!checkRateLimit(uid).allowed) return;
    const { result, model } = await generateEssayFeedback({
      question: ctx.question,
      charLimit: ctx.char_limit,
      answer,
      companyName: ctx.company_name,
      jobTitle: ctx.job_title,
      position: ctx.job_position,
      jobMemo: [ctx.application_memo, ctx.job_memo].filter(Boolean).join('\n'),
    });
    if (!db.open) return;
    saveEssayFeedback(db, uid, { essayId: ctx.essay_id, questionId: ctx.question_id, model, result });
  }
}

// Returns the tracked promise when background feedback started, else null.
function scheduleAutoFeedback(db, userId, essayId) {
  const uid = Number(userId);
  if (!isAiEnabled() || !isAutoFeedbackOn(db, uid)) return null;
  const questionIds = db
    .prepare(`
      SELECT eq.id FROM essay_questions eq
      INNER JOIN essays e ON e.id = eq.essay_id
      WHERE e.id = ? AND e.user_id = ? AND trim(eq.answer) <> ''
      ORDER BY eq.sort_order ASC, eq.id ASC
    `)
    .all(Number(essayId), uid)
    .map((row) => row.id);
  if (questionIds.length === 0) return null;
  return runInBackground('essay-feedback', () => generateFeedbackForQuestions(db, uid, Number(essayId), questionIds));
}

module.exports = {
  INTERVIEW_STAGES,
  deadlineEventTitle,
  ensureTodo,
  ensureDeadlineEvent,
  onJobCreated,
  onApplicationCreated,
  onStageChanged,
  scheduleStageAi,
  isAutoFeedbackOn,
  scheduleAutoFeedback,
};
