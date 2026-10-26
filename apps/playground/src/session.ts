// Drives one incremental healer the way a stream would: stepping forward pushes the
// new chunks, anything else (scrubbing back, jumping far) is a `set`. Every step is
// timed, next to a stateless `heal()` of the same prefix for comparison.

import type { StreamChunk } from "@typstream/corpus/stream";
import { createHealer, type Healer, type HealOptions, type HealResult, heal } from "@typstream/heal";

/** Jumps forward by more than this many steps use `set` instead of pushing each chunk. */
const MAX_PUSHES = 64;

export interface Step {
  input: string;
  result: HealResult;
  /** How the healer got here: `push ×n`, `set`, or `finish` (after a push/set). */
  op: string;
  /** Wall time of the incremental operation(s), ms. */
  ms: number;
  /** Wall time of a stateless `heal(input)` with the same options, ms. */
  statelessMs: number;
}

export class HealSession {
  private healer: Healer;
  private at = 0;
  private finished = false;
  private last: { at: number; final: boolean; step: Step } | null = null;

  constructor(
    private readonly chunks: readonly StreamChunk[],
    /** The whole stream joined; the input after `i` steps is `source.slice(0, prefixes[i])`. */
    private readonly source: string,
    private readonly prefixes: readonly number[],
    private readonly options: HealOptions,
  ) {
    this.healer = createHealer(options);
  }

  /** Moves to `at` steps. Asking again for the current step returns it as it was, timings included. */
  goto(at: number, final: boolean): Step {
    if (this.last?.at === at && this.last.final === final) return this.last.step;
    const input = this.inputAt(at);
    const start = performance.now();
    let op: string;
    if (this.finished) {
      // finish() is sticky: start over from a fresh, streaming healer.
      this.healer.reset();
      this.finished = false;
      this.at = 0;
    }
    if (at >= this.at && at - this.at <= MAX_PUSHES) {
      for (let i = this.at; i < at; i++) this.healer.push((this.chunks[i] as StreamChunk).text);
      op = `push ×${at - this.at}`;
    } else {
      this.healer.set(input);
      op = "set";
    }
    let result = this.healer.result();
    if (final) {
      result = this.healer.finish();
      this.finished = true;
      op += " + finish";
    }
    const ms = performance.now() - start;
    this.at = at;

    const statelessStart = performance.now();
    heal(input, { ...this.options, final });
    const statelessMs = performance.now() - statelessStart;
    const step = { input, result, op, ms, statelessMs };
    this.last = { at, final, step };
    return step;
  }

  inputAt(at: number): string {
    return this.source.slice(0, this.prefixes[at]);
  }
}

export interface Profile {
  /** Time of each `push`, ms; index i is the push of chunk i. */
  pushMs: Float64Array;
  totalMs: number;
  p50: number;
  p95: number;
  max: number;
  /** Chunk index of the slowest push. */
  maxAt: number;
}

const percentile = (sorted: Float64Array, q: number): number =>
  sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);

/**
 * Streams every chunk through a fresh healer and times each push. Yields to the
 * event loop every ~30 ms so long streams don't freeze the page; `signal` aborts.
 */
export const profileStream = async (
  chunks: readonly StreamChunk[],
  options: HealOptions,
  signal: AbortSignal,
  onProgress?: (done: number) => void,
): Promise<Profile | null> => {
  const healer = createHealer(options);
  const pushMs = new Float64Array(chunks.length);
  let sliceStart = performance.now();
  for (let i = 0; i < chunks.length; i++) {
    const t0 = performance.now();
    healer.push((chunks[i] as StreamChunk).text);
    const t1 = performance.now();
    pushMs[i] = t1 - t0;
    if (t1 - sliceStart > 30) {
      onProgress?.(i + 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal.aborted) return null;
      sliceStart = performance.now();
    }
  }
  const sorted = pushMs.slice().sort();
  let maxAt = 0;
  for (let i = 1; i < pushMs.length; i++) if ((pushMs[i] as number) > (pushMs[maxAt] as number)) maxAt = i;
  return {
    pushMs,
    totalMs: pushMs.reduce((a, b) => a + b, 0),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: (pushMs[maxAt] as number | undefined) ?? 0,
    maxAt,
  };
};
