// Top-level blocks: the units the engine's source anchors (PLAN §10.2) and Layer 4's block
// isolation (§5.6) work in, and where a streaming range (§5.2) starts and ends. A block starts
// at a root checkpoint (the recognizer's, §5.2) at the start of the text, after a blank line, or
// at a heading. Checkpoints sit at every root line, but a soft line break doesn't start a block.
// Two block starts are skipped, because the engine's anchor element there would change the
// document:
// - a list, enum or term item right after an item of the same kind (a wide list, `+ a⏎⏎+ b`):
//   an element between them would split the list in two and restart its numbering;
// - a line starting with `<`: a label there attaches to the element before it.

import { type Checkpoint, recognize } from "./recognizer";

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

/**
 * Offsets of the lines that start a top-level block, the start of the text included when a
 * block starts there (not before a label). The engine's source anchors go there.
 * @internal
 */
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
 * Starts of a text's top-level blocks: 0, then the start of each line where a block starts (a
 * line after a blank line, or a heading, at the top level). Block `i` runs to the start of block
 * `i + 1`, the last one to the end of the text. A `#question[…]` with blank lines inside is one
 * block. `checkpoints` are the text's recognition's, when you have it.
 * @beta
 */
export const blockStarts = (text: string, checkpoints = recognize(text).checkpoints): number[] => [
  0,
  ...anchorPoints(text, checkpoints).filter((at) => at > 0),
];
