// Idle-time callbacks. WebKit has no requestIdleCallback, so it falls back to a
// timer with a short budget, which still yields to input and rendering between
// pages.

/** Stops a scheduled callback. */
export type Cancel = () => void;

/** Fallback budget per callback, in ms: about half a frame. */
const FALLBACK_BUDGET = 8;

/** Runs `work` when the browser is idle; it may draw until `timeRemaining()` reaches 0. */
export const idle = (work: (timeRemaining: () => number) => void): Cancel => {
  if (typeof requestIdleCallback === "function") {
    // A timeout, so a page that never goes idle (a busy stream) still catches up.
    const handle = requestIdleCallback((deadline) => work(() => deadline.timeRemaining()), { timeout: 500 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(() => {
    const end = performance.now() + FALLBACK_BUDGET;
    work(() => end - performance.now());
  }, 16);
  return () => clearTimeout(handle);
};
