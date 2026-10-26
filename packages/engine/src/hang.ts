// Finding what hangs a finished document (PLAN §5.6 level 3, §6.3). A compile
// the watchdog stops, or that crashes the worker, says nothing about where the
// trouble is, and the worker can't stop a running compile itself. So the
// client bisects: it compiles prefixes of the document, the rest skipped
// (`fallback.skip`), each under its own budget. A prefix of `k` blocks
// finishes and one of `k + 1` doesn't: block `k` is skipped from then on, and
// the search goes on with the whole document, until it finishes. Blocks are
// the server's (heal's root checkpoints, `blockStarts`).

import type { SkippedRange } from "@typstream/core";
import { blockStarts } from "./server/anchors";

/** Most compiles one search runs before giving up: it costs a budget per hang. */
export const MAX_HANG_PROBES = 16;

/** @internal What to compile next while looking for the blocks that hang a text. */
export class HangSearch {
  private readonly starts: number[];
  /** Blocks found to hang, ascending; skipped in every compile from then on. */
  private readonly found: SkippedRange[] = [];
  /** Prefix [0, lo) of the blocks finishes (with `found` skipped); [0, hi) doesn't. */
  private lo = 0;
  private hi: number;
  /** Why prefix [0, hi) didn't finish. */
  private reason: SkippedRange["reason"];
  /** The prefix (in blocks) the next compile tries, or `null` for the whole text. */
  private probe: number | null = null;
  private probes = 0;
  /** The whole text finished with `found` skipped, or the search gave up. */
  done = false;

  /** `text` (the source the worker compiles) didn't finish, for `reason`. */
  constructor(
    readonly text: string,
    reason: SkippedRange["reason"],
  ) {
    this.starts = blockStarts(text);
    this.hi = this.starts.length;
    this.reason = reason;
    this.next();
  }

  /** Ranges for `fallback.skip` in the next compile. */
  skip(): SkippedRange[] {
    const { probe } = this;
    if (probe === null) return [...this.found];
    return [...this.found, { from: this.starts[probe] as number, to: this.text.length, reason: this.reason }];
  }

  /** Whether the next compile only probes a prefix (its output isn't the document's). */
  get probing(): boolean {
    return this.probe !== null;
  }

  /**
   * The compile with `skip()` finished (`null`), or didn't. Returns false when
   * the search gives up: too many compiles, or nothing left to skip.
   */
  answer(stopped: SkippedRange["reason"] | null): boolean {
    if (this.done) return true;
    if (stopped === null && this.probe === null) {
      this.done = true;
      return true;
    }
    if (stopped !== null) this.reason = stopped;
    if (this.probe === null) this.hi = this.starts.length;
    else if (stopped === null) this.lo = this.probe;
    else this.hi = this.probe;
    return this.next();
  }

  private next(): boolean {
    if (++this.probes > MAX_HANG_PROBES || this.lo >= this.hi) {
      // Give up, skipping what was found.
      this.done = true;
      this.probe = null;
      return false;
    }
    if (this.hi - this.lo > 1) {
      this.probe = (this.lo + this.hi) >> 1;
      return true;
    }
    // Prefix `lo` finishes and `lo + 1` doesn't: skip block `lo`, then try everything.
    this.found.push({
      from: this.starts[this.lo] as number,
      to: this.starts[this.lo + 1] ?? this.text.length,
      reason: this.reason,
    });
    this.lo = this.hi;
    this.probe = null;
    return true;
  }
}
