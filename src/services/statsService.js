const {
  APPLICATION_STAGES,
  STAGE_LABELS,
} = require('../middleware/validation');

const STAGE_INDEX_MAP = Object.fromEntries(
  APPLICATION_STAGES.map((stage, idx) => [stage, idx])
);

function getYearMonth(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Pass-rate and funnel calculation rules (all user-scoped):
 *
 * 1. Funnel (reached stage S):
 *    An application has reached stage S (index sIdx) if its current stage index >= sIdx,
 *    OR stage S (or any stage with index >= sIdx) appears in its `stage_logs` history.
 *
 * 2. Stage pass rate (moved past stage S / reached stage S):
 *    - For non-final stages (sIdx < 5): an application moved past stage S if the highest
 *      stage index it ever reached is > sIdx, OR (it is currently at stage S with result = 'passed').
 *    - For the final stage (sIdx === 5): an application moved past 'final' if it reached 'final'
 *      and has result = 'passed' (currently or in stage_logs).
 *
 * 3. Document pass rate (서류 합격률, documentPassRate):
 *    Defined as:
 *      (applications that reached coding_test or later [index >= 1], or passed at document)
 *      / (applications whose document stage is decided: moved on to index >= 1 [or passed at document]
 *         OR result = 'failed' at document stage).
 *    In-progress or withdrawn applications still at 'document' are excluded from the denominator.
 */
function computeConversionStats(db, userId, now = new Date()) {
  const uid = Number(userId);

  const apps = db
    .prepare(`
      SELECT id, stage, result, applied_at, created_at
      FROM applications
      WHERE user_id = ?
    `)
    .all(uid);

  const logs = db
    .prepare(`
      SELECT sl.application_id, sl.from_stage, sl.to_stage, sl.from_result, sl.to_result
      FROM stage_logs sl
      INNER JOIN applications a ON a.id = sl.application_id
      WHERE a.user_id = ?
    `)
    .all(uid);

  const logsByApp = new Map();
  for (const log of logs) {
    if (!logsByApp.has(log.application_id)) {
      logsByApp.set(log.application_id, []);
    }
    logsByApp.get(log.application_id).push(log);
  }

  const appMeta = apps.map((app) => {
    const curIdx = STAGE_INDEX_MAP[app.stage] ?? 0;
    let maxIdx = curIdx;
    const visitedStages = new Set([app.stage]);
    let passedFinal = app.stage === 'final' && app.result === 'passed';

    const appLogs = logsByApp.get(app.id) || [];
    for (const lg of appLogs) {
      if (lg.from_stage && STAGE_INDEX_MAP[lg.from_stage] !== undefined) {
        visitedStages.add(lg.from_stage);
        if (STAGE_INDEX_MAP[lg.from_stage] > maxIdx) {
          maxIdx = STAGE_INDEX_MAP[lg.from_stage];
        }
      }
      if (lg.to_stage && STAGE_INDEX_MAP[lg.to_stage] !== undefined) {
        visitedStages.add(lg.to_stage);
        if (STAGE_INDEX_MAP[lg.to_stage] > maxIdx) {
          maxIdx = STAGE_INDEX_MAP[lg.to_stage];
        }
      }
      if (lg.to_stage === 'final' && lg.to_result === 'passed') {
        passedFinal = true;
      }
    }

    return {
      ...app,
      curIdx,
      maxIdx,
      visitedStages,
      passedFinal,
    };
  });

  const passRates = {};
  const passRateList = [];
  const funnelCounts = [];
  const funnelByStage = {};

  for (let sIdx = 0; sIdx < APPLICATION_STAGES.length; sIdx += 1) {
    const stage = APPLICATION_STAGES[sIdx];
    const label = STAGE_LABELS[stage] || stage;

    let reached = 0;
    let movedPast = 0;
    let failed = 0;

    for (const item of appMeta) {
      const hasReached = item.maxIdx >= sIdx || item.visitedStages.has(stage);
      if (!hasReached) continue;
      reached += 1;

      const hasMovedPast =
        sIdx === APPLICATION_STAGES.length - 1
          ? item.passedFinal
          : item.maxIdx > sIdx || (item.curIdx === sIdx && item.result === 'passed');

      if (hasMovedPast) {
        movedPast += 1;
      } else if (item.curIdx === sIdx && item.result === 'failed') {
        failed += 1;
      }
    }

    const decided = movedPast + failed;
    const rate = reached > 0 ? Math.round((movedPast / reached) * 100) : 0;
    const decidedRate = decided > 0 ? Math.round((movedPast / decided) * 100) : 0;

    const entry = {
      stage,
      label,
      reached,
      movedPast,
      passed: movedPast,
      failed,
      decided,
      rate,
      decidedRate,
    };
    passRates[stage] = entry;
    passRateList.push(entry);
    funnelCounts.push(reached);
    funnelByStage[stage] = reached;
  }

  const docEntry = passRates.document;
  const documentPassRate = docEntry ? docEntry.decidedRate : 0;

  const thisMonthKey = getYearMonth(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = getYearMonth(prevDate);

  const monthCountStmt = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM applications
    WHERE user_id = ?
      AND strftime('%Y-%m', COALESCE(applied_at, created_at)) = ?
  `);
  const thisMonthCount = Number(monthCountStmt.get(uid, thisMonthKey).cnt) || 0;
  const lastMonthCount = Number(monthCountStmt.get(uid, lastMonthKey).cnt) || 0;
  const monthDelta = thisMonthCount - lastMonthCount;

  const funnel = {
    stages: APPLICATION_STAGES,
    labels: APPLICATION_STAGES.map((s) => STAGE_LABELS[s] || s),
    counts: funnelCounts,
    byStage: funnelByStage,
  };

  const monthComparison = {
    thisMonthKey,
    lastMonthKey,
    thisMonth: thisMonthCount,
    lastMonth: lastMonthCount,
    delta: monthDelta,
  };

  return {
    passRates,
    passRateList,
    documentPassRate,
    documentStats: {
      reached: docEntry.reached,
      movedPast: docEntry.movedPast,
      failed: docEntry.failed,
      decided: docEntry.decided,
      rate: documentPassRate,
    },
    funnel,
    thisMonthCount,
    lastMonthCount,
    monthDelta,
    monthComparison,
  };
}

module.exports = {
  STAGE_INDEX_MAP,
  computeConversionStats,
};
