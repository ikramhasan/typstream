// Time, injectable. The engine runs in browsers and Node alike and its lib is
// plain ES2022 (no DOM, no Node types), so the timer globals are looked up on
// `globalThis` at call time, which is also what lets fake timers replace them.

/**
 * The timers the engine uses for scheduling and the watchdog. Defaults to the
 * global `setTimeout` / `clearTimeout` and `Date.now`.
 * @public
 */
export interface Clock {
  /** Milliseconds, monotone enough for intervals. */
  now(): number;
  /** Calls `callback` once after `ms` milliseconds; returns a handle for `clearTimeout`. */
  setTimeout(callback: () => void, ms: number): unknown;
  /** Cancels a pending `setTimeout`. */
  clearTimeout(handle: unknown): void;
}

interface TimerGlobals {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const timers = (): TimerGlobals => globalThis as unknown as TimerGlobals;

/** @internal */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => timers().setTimeout(callback, ms),
  clearTimeout: (handle) => timers().clearTimeout(handle),
};
