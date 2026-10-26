// Compile pacing (PLAN §6.2). Tokens arrive every ~20 ms and a compile takes
// 5–100 ms, so a document compiles at most once per interval and the interval
// follows how long its compiles take: small documents update at ~30 fps, big
// ones less often, and the worker never falls behind.

/**
 * How often a document compiles while it streams.
 * @public
 */
export interface ScheduleOptions {
  /** Shortest time between the starts of two compiles. Default 33 ms (≈ 30 fps). */
  minInterval: number;
  /** Longest time between them while the document changes. Default 500 ms. */
  maxInterval: number;
  /**
   * Compile after `minInterval` instead of the full adaptive interval when
   * heal's `stableOffset` has advanced since the last compile: a line or block
   * just finished, which is a better moment to show than the middle of a word.
   * Default true.
   */
  boundaryBias: boolean;
}

/** 33 ms to 500 ms between compiles, with boundary bias. @public */
export const DEFAULT_SCHEDULE: Readonly<ScheduleOptions> = { minInterval: 33, maxInterval: 500, boundaryBias: true };

/** Weight of the newest sample in the moving average of compile times. */
const EMA_ALPHA = 0.3;

/** Headroom over the average compile time, so the worker idles between compiles. */
const HEADROOM = 1.25;

/** @internal The exponential moving average after one more compile time; the first sample starts it. */
export const updateEma = (ema: number | null, sample: number): number =>
  ema === null ? sample : ema + EMA_ALPHA * (sample - ema);

/** @internal `clamp(min, 1.25 × EMA(compileMs), max)`; `min` before the first compile. */
export const compileInterval = (ema: number | null, opts: ScheduleOptions): number =>
  Math.min(opts.maxInterval, Math.max(opts.minInterval, HEADROOM * (ema ?? 0)));
