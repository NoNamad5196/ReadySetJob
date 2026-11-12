// Fire-and-forget background work tracker.
// HTTP handlers call runInBackground() and return immediately; failures are
// caught and logged so they never crash the process or affect the response.
// Tests await waitForBackgroundTasks() to observe the finished side effects.

const pending = new Set();

function runInBackground(label, taskFn) {
  const promise = Promise.resolve()
    .then(taskFn)
    .catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[background:${label}]`, err && err.message ? err.message : err);
      }
      return null;
    })
    .finally(() => {
      pending.delete(promise);
    });
  pending.add(promise);
  return promise;
}

async function waitForBackgroundTasks() {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

module.exports = { runInBackground, waitForBackgroundTasks };
