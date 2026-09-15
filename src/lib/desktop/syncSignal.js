/**
 * Lets code that records a local change ask the sync engine to push soon, without importing it
 * (the engine imports the models, and the models import the change tracker).
 *
 * Next.js bundles each API route separately, so shared state lives on globalThis.
 */

const RUNNER_KEY = '__ibilePosSyncRunner';
const TIMER_KEY = '__ibilePosSyncTimer';

export function registerSyncRunner(runner) {
  globalThis[RUNNER_KEY] = runner;
}

export function requestSyncSoon(delayMs = 5000) {
  if (globalThis[TIMER_KEY]) return;
  const timer = setTimeout(() => {
    globalThis[TIMER_KEY] = null;
    const runner = globalThis[RUNNER_KEY];
    if (typeof runner === 'function') Promise.resolve(runner()).catch(() => {});
  }, delayMs);
  timer.unref?.();
  globalThis[TIMER_KEY] = timer;
}
