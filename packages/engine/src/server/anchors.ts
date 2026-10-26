// Source anchors for HTML compiles (PLAN §10.2). Typst's HTML export carries no
// source spans, so before an HTML compile the server writes an invisible
// element in front of each top-level block:
//
//   #std.html.elem("typstream-anchor", attrs: ("data-src": "<offset>"));
//
// typst-html groups only phrasing content into paragraphs, and a custom element
// isn't phrasing content, so the anchor comes out as a block-level sibling of
// the block it marks and adds no paragraph or space of its own. The renderer
// (@typstream/dom) turns anchors into `data-typstream-src` attributes and drops
// them. With them stripped, the HTML is byte-identical to a compile without
// anchors (tested over the corpus in __tests__/anchors.test.ts).
//
// Anchors go only at block starts: a root checkpoint (heal's recognizer, §5.2)
// at the start of the text, after a blank line, or at a heading. Checkpoints sit
// at every root line, but an anchor at a soft line break would split the
// paragraph. Two block starts are skipped because an element there changes
// the document:
// - a list, enum or term item right after an item of the same kind (a wide
//   list, `+ a⏎⏎+ b`): the anchor would split it in two and restart numbering;
// - a line starting with `<`: a label there attaches to the element before it,
//   which would be the anchor.

import { diffEdit } from "@typstream/core";
import { type Checkpoint, recognize } from "@typstream/heal";

/** What anchors were inserted where, to map compiler positions back to the document. */
export interface Anchored {
  /** The document with anchors. */
  text: string;
  /** Document offsets of the lines anchors were inserted before, ascending. */
  at: number[];
  /** Start of each anchor in `text`. */
  start: number[];
  /** Length of each anchor in `text`. */
  length: number[];
}

/** The text inserted for an anchor before the line at `offset`. */
export const anchorText = (offset: number): string =>
  `#std.html.elem("typstream-anchor", attrs: ("data-src": "${offset}"));\n`;

type Kind = "heading" | "list" | "enum" | "term" | "label" | "other";

// Markers as heal's lexer reads them (lexer.ts, `markup`): `=`, `-`, `+`, `/`
// or `1.` followed by whitespace, a comment or the end of the text.
const MARKER = /(?:(=+)|(-)|(\+|\d{1,19}\.)|(\/))(?=\s|$|\/\/|\/\*)/y;

const kindAt = (text: string, at: number): Kind => {
  if (text.charCodeAt(at) === 0x3c /* < */) return "label";
  MARKER.lastIndex = at;
  const m = MARKER.exec(text);
  if (!m) return "other";
  return m[1] ? "heading" : m[2] ? "list" : m[3] ? "enum" : "term";
};

const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Whether only whitespace with a blank line (or nothing) precedes `at`. */
const afterBlankLine = (text: string, at: number): boolean => {
  let newlines = 0;
  let i = at;
  while (i > 0 && isSpace(text.charCodeAt(i - 1))) {
    if (text.charCodeAt(i - 1) === 0x0a) newlines++;
    i--;
  }
  return i === 0 || newlines >= 2;
};

/** Offsets of the lines that get an anchor. */
export const anchorPoints = (text: string, checkpoints: readonly Checkpoint[]): number[] => {
  const points: number[] = [];
  let previous: Kind | null = null;
  for (const cp of checkpoints) {
    if (cp.nesting !== 0) continue;
    const kind = kindAt(text, cp.offset);
    const item = kind === "list" || kind === "enum" || kind === "term";
    if ((kind === "heading" || afterBlankLine(text, cp.offset)) && kind !== "label" && !(item && kind === previous)) {
      points.push(text.lastIndexOf("\n", cp.offset - 1) + 1);
    }
    previous = kind;
  }
  return points;
};

/**
 * Starts of a text's top-level blocks (PLAN §5.6): 0, then each line an anchor
 * goes before. Block `i` runs to the start of block `i + 1`, the last one to
 * the end of the text.
 */
export const blockStarts = (text: string, checkpoints = recognize(text).checkpoints): number[] => [
  0,
  ...anchorPoints(text, checkpoints).filter((at) => at > 0),
];

/**
 * Inserts anchors at `points` (line starts, ascending). `label` turns a point
 * into the offset the anchor names: the identity, or, for a text the worker
 * fixed (Layer 3), the offset in the client's text.
 */
export const insertAnchors = (
  text: string,
  points: readonly number[],
  label: (at: number) => number = (at) => at,
): Anchored => {
  const parts: string[] = [];
  const start: number[] = [];
  const length: number[] = [];
  let last = 0;
  let shift = 0;
  for (const at of points) {
    const anchor = anchorText(label(at));
    parts.push(text.slice(last, at), anchor);
    start.push(at + shift);
    length.push(anchor.length);
    shift += anchor.length;
    last = at;
  }
  parts.push(text.slice(last));
  return { text: parts.join(""), at: [...points], start, length };
};

/**
 * Maps a position in anchored text to the document. A position inside an
 * anchor maps to the line it was inserted before.
 */
export const fromAnchored = (a: Anchored, pos: number): number => {
  // Last anchor starting at or before `pos`.
  let lo = 0;
  let hi = a.start.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((a.start[mid] as number) <= pos) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (i < 0) return pos;
  const start = a.start[i] as number;
  const end = start + (a.length[i] as number);
  if (pos < end) return a.at[i] as number;
  return pos - (end - (a.at[i] as number));
};

/**
 * One document's anchoring. Keeps heal's root checkpoints between compiles and
 * re-recognizes only from before the first change, so a streamed append costs
 * the tail, not the document.
 */
export class Anchors {
  private text = "";
  private checkpoints: Checkpoint[] = [];
  /** Earliest offset changed since the checkpoints were computed; `null` when they are current. */
  private changedFrom: number | null = 0;

  /** Notes that the text changed from `from` on (in the text after the change). */
  changed(from: number): void {
    this.changedFrom = this.changedFrom === null ? from : Math.min(this.changedFrom, from);
  }

  /**
   * `text` with anchors. Changes not reported with `changed` are found by
   * comparing with the last text. `label` is {@link insertAnchors}'.
   */
  apply(text: string, label?: (at: number) => number): Anchored {
    if (this.changedFrom !== null || text !== this.text) {
      const from = Math.min(this.changedFrom ?? text.length, diffEdit(this.text, text)?.from ?? text.length);
      const old = this.checkpoints;
      // As heal resumes after an edit (heal.ts, `updateState`): at the last
      // checkpoint whose following one is still at or before the change, since
      // the lexer may read past a checkpoint's own line to end its token.
      let n = 0;
      while (n < old.length && (old[n] as Checkpoint).offset < from + 1) n++;
      const resume = old[n - 2];
      const kept = resume ? old.slice(0, n - 2) : [];
      this.checkpoints = kept.concat(recognize(text, resume).checkpoints);
      this.text = text;
      this.changedFrom = null;
    }
    return insertAnchors(text, anchorPoints(text, this.checkpoints), label);
  }
}
