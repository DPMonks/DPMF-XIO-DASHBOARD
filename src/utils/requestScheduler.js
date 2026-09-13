// Background /api calls share a small pool so Railway 429s stay rare.
// Token-detail SELECTs skip this and run immediately.

export function createRequestScheduler({ concurrency = 2 } = {}) {
  const max = Math.max(1, Number(concurrency) || 1);
  let active = 0;
  const waiting = [];

  function pump() {
    waiting.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    while (active < max && waiting.length) {
      const next = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          pump();
        })
        .catch(() => {});
    }
  }

  return function schedule(task, { immediate = false, priority = 0 } = {}) {
    if (immediate) return Promise.resolve().then(task);
    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject, priority: Number(priority) || 0 });
      pump();
    });
  };
}
