// Contracts shared by every typstream package. No dependencies, types plus a
// few tiny pure helpers. All offsets are UTF-16 code unit indices (JavaScript
// string indices).

/** A half-open range `[from, to)` in a string. */
export interface Range {
  from: number;
  to: number;
}

/** Who made an edit. Streaming is just one kind of edit. */
export type EditOrigin = "stream" | "user" | "ai" | "remote";

/** Replace `[from, to)` with `insert`. An append is `from = to = length`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  origin?: EditOrigin;
}

/** Applies a single edit to a string. */
export const applyEdit = (text: string, edit: TextEdit): string =>
  text.slice(0, edit.from) + edit.insert + text.slice(edit.to);

/**
 * Maps a position through an edit. Positions inside the replaced range move to
 * the end of the insertion when `assoc` is 1 (default) or to its start when -1.
 */
export const mapPosition = (pos: number, edit: TextEdit, assoc: 1 | -1 = 1): number => {
  if (pos < edit.from) return pos;
  if (pos > edit.to) return pos + edit.insert.length - (edit.to - edit.from);
  if (pos === edit.from && assoc < 0) return pos;
  if (pos === edit.from && edit.from === edit.to) return assoc < 0 ? pos : pos + edit.insert.length;
  return assoc < 0 ? edit.from : edit.from + edit.insert.length;
};

/** The smallest single edit turning `prev` into `next` (common prefix/suffix diff). */
export const diffEdit = (prev: string, next: string): TextEdit | null => {
  if (prev === next) return null;
  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  // Don't split a surrogate pair.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < max - start && prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) {
    end++;
  }
  if (end > 0 && isLowSurrogate(prev.charCodeAt(prev.length - end))) end--;
  return { from: start, to: prev.length - end, insert: next.slice(start, next.length - end) };
};

/** @internal UTF-16 helpers shared by typstream packages. */
export const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
/** @internal */
export const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * One change a transform made to a text. `original` is the range in the input,
 * `result` the range in the output; deletions have an empty `result`, pure
 * insertions an empty `original`.
 */
export interface Patch {
  original: Range;
  result: Range;
  /** Machine-readable cause, e.g. `"close:]"`, `"cut:incomplete-statement"`, `"lint:email-at"`. */
  reason: string;
}

/**
 * Bidirectional position mapping between an input and the output of a transform,
 * built from non-overlapping patches sorted by `original.from`.
 */
export class SourceMap {
  readonly patches: readonly Patch[];

  constructor(patches: readonly Patch[]) {
    this.patches = patches;
  }

  /** Maps an input position to the output. Positions inside deleted text map to the deletion point. */
  toResult(pos: number): number {
    let delta = 0;
    for (const p of this.patches) {
      if (pos < p.original.from) break;
      if (pos < p.original.to) return p.result.from;
      delta = p.result.to - p.original.to;
    }
    return pos + delta;
  }

  /**
   * Maps an output position to the input. Positions inside inserted text map to
   * the insertion point. At a deletion, `assoc` 1 (default) maps past the
   * deleted text, -1 before it.
   */
  toOriginal(pos: number, assoc: 1 | -1 = 1): number {
    let delta = 0;
    for (const p of this.patches) {
      if (pos < p.result.from) break;
      if (assoc < 0 && pos === p.result.from && p.result.to === p.result.from) break;
      if (pos < p.result.to) return p.original.from;
      delta = p.original.to - p.result.to;
    }
    return pos + delta;
  }
}

export * from "./diagnostic";
export * from "./plugin";
export * from "./protocol";
export * from "./telemetry";
export * from "./wire";
