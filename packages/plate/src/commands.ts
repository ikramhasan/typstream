// What the editor's commands do to the Typst: each returns the edits of the source, smallest first in the text's
// order, or `null` when the command can't apply there. They read only the source around the positions they are given
// (offsets into it); where those are comes from the HTML's source spans (session.ts).

import type { TextEdit } from "@typstream/core";

/** Characters with a meaning in markup wherever they are (Typst's lexer, `markup`): escaped when typed. */
const SPECIAL = /[\\#*_$`<@[\]~]/;
/** What starts a block at the start of a line: a heading, a list item, an enum item, a term. */
const LINE_START = /^[=\-+/]/;

const lineStart = (source: string, at: number): number => source.lastIndexOf("\n", at - 1) + 1;

/**
 * One line of typed text as markup at `at`: what has a meaning escaped, so it shows as typed. `lead` is what its line
 * has before it (`null` for a line of its own): a marker at the line's start, or a `.` after only digits there (`1.`,
 * typed one key at a time as much as at once), would start a block.
 */
const escapeLine = (source: string, at: number, line: string, lead: string | null): string => {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    const before = i === 0 ? source[at - 1] : line[i - 1];
    const after = i === line.length - 1 ? source[at] : line[i + 1];
    // A line comment or a block comment's start.
    const comment = c === "/" && (before === "/" || after === "/" || after === "*");
    const head = lead === null ? line.slice(0, i) : lead + line.slice(0, i);
    const marker = /^[ \t]*$/.test(head) ? LINE_START.test(c) : c === "." && /^[ \t]*\d+$/.test(head);
    out += SPECIAL.test(c) || comment || marker ? `\\${c}` : c;
  }
  return out;
};

/**
 * Text typed at `at`, as markup: escaped, and lines after the first as paragraphs of their own (a paste).
 */
export const typed = (source: string, at: number, text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line, i) => escapeLine(source, at, line, i === 0 ? source.slice(lineStart(source, at), at) : null))
    .join("\n\n");

/** Typing `text` at `at`. */
export const insertText = (source: string, at: number, text: string): TextEdit[] => {
  const insert = typed(source, at, text);
  return insert ? [{ from: at, to: at, insert }] : [];
};

/** A list or enum item's line: its indent and marker. */
const ITEM = /^([ \t]*)([-+]|\d+\.)([ \t]+)/;

/**
 * Enter at `at`: a new paragraph, or a new item in a list. `soft` (Shift+Enter): a line break (`\`). An empty item
 * ends its list.
 */
export const insertBreak = (source: string, at: number, soft = false): TextEdit[] => {
  if (soft) return [{ from: at, to: at, insert: "\\\n" }];
  const start = lineStart(source, at);
  const end = source.indexOf("\n", at) === -1 ? source.length : source.indexOf("\n", at);
  const line = source.slice(start, end);
  const item = ITEM.exec(line);
  if (item) {
    // An item with nothing in it: the list ends there.
    if (line.slice(item[0].length).trim() === "") return [{ from: start, to: end, insert: "" }];
    const marker = /\d/.test(item[2] as string) ? "+" : (item[2] as string);
    return [{ from: at, to: at, insert: `\n${item[1]}${marker} ` }];
  }
  // Spaces before the break would end the line: they go.
  let from = at;
  while (from > start && (source[from - 1] === " " || source[from - 1] === "\t")) from--;
  return [{ from, to: at, insert: "\n\n" }];
};

/**
 * Source between two blocks whose break deleting joins them: the blank line between paragraphs, a list item's line
 * break and marker, a heading's; after the delimiters that close the first block's last text and before those that
 * open the second's (`*`, `_`, `]`, `#strong[`). Never code between them (a call's arguments).
 */
const JOINABLE =
  /^((?:[*_]|\])*)([ \t]*(?:\\[ \t]*)?\n[ \t\n]*(?:(?:=+|[-+]|\d+\.)[ \t]+)?)((?:[*_]|#[\p{L}_][\p{L}\p{N}_-]*\[)*)$/u;

/** Joins the block whose text ends at `end` with the one whose text starts at `start`, if only a break is between. */
export const join = (source: string, end: number, start: number): TextEdit[] | null => {
  const m = start > end ? JOINABLE.exec(source.slice(end, start)) : null;
  if (!m) return null;
  const from = end + (m[1] as string).length;
  return [{ from, to: from + (m[2] as string).length, insert: "" }];
};

// --- marks ------------------------------------------------------------------------------

/** The marks the toolbar has, and how Typst writes them. */
export type Mark = "bold" | "italic" | "underline" | "strike";

const MARKS: Record<Mark, { delimiter?: string; fn: string }> = {
  bold: { delimiter: "*", fn: "strong" },
  italic: { delimiter: "_", fn: "emph" },
  underline: { fn: "underline" },
  strike: { fn: "strike" },
};

const WORD = /[\p{L}\p{N}]/u;

/** The text `[from, to)` (spaces at its ends left out) in `mark`: `*…*` where Typst allows it, else `#strong[…]`. */
export const wrapMark = (source: string, from: number, to: number, mark: Mark): TextEdit[] | null => {
  while (from < to && /\s/.test(source[from] as string)) from++;
  while (to > from && /\s/.test(source[to - 1] as string)) to--;
  if (from >= to) return null;
  const { delimiter, fn } = MARKS[mark];
  const inside = source.slice(from, to);
  // Delimiters work at word boundaries, around text without them.
  const plain =
    delimiter !== undefined &&
    !inside.includes(delimiter) &&
    !WORD.test(source[from - 1] ?? "") &&
    !WORD.test(source[to] ?? "") &&
    source[from - 1] !== "\\";
  const [open, close] = plain ? [delimiter, delimiter] : [`#${fn}[`, "]"];
  return [
    { from, to: from, insert: open as string },
    { from: to, to, insert: close as string },
  ];
};

/** Takes the mark written at `[from, to)` (`*…*`, `_…_`, `#strong[…]`) off what it holds. */
export const unwrapMark = (source: string, from: number, to: number): TextEdit[] | null => {
  const text = source.slice(from, to);
  const call = /^#[\p{L}_][\p{L}\p{N}_-]*\[/u.exec(text);
  if (call && text.endsWith("]")) {
    return [
      { from, to: from + call[0].length, insert: "" },
      { from: to - 1, to, insert: "" },
    ];
  }
  if (text.length >= 2 && (text[0] === "*" || text[0] === "_") && text[text.length - 1] === text[0]) {
    return [
      { from, to: from + 1, insert: "" },
      { from: to - 1, to, insert: "" },
    ];
  }
  return null;
};

/** Which mark the syntax at `[from, to)` writes, if it is one. */
export const markOf = (source: string, from: number, to: number): Mark | null => {
  const text = source.slice(from, to);
  if (text.startsWith("*") || text.startsWith("#strong[")) return "bold";
  if (text.startsWith("_") || text.startsWith("#emph[")) return "italic";
  if (text.startsWith("#underline[")) return "underline";
  if (text.startsWith("#strike[")) return "strike";
  return null;
};

// --- blocks -----------------------------------------------------------------------------

/** What a block can be turned into. */
export type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "numbered";

/** The markers a line may start with, and the delimiters and calls that may come before the block's text. */
const PREFIX = /^([ \t]*)((?:=+|[-+]|\d+\.)[ \t]+)?((?:[*_]|#[\p{L}_][\p{L}\p{N}_-]*\[)*)$/u;

/**
 * Turns the block whose text starts at `at` into `kind`: the marker at the start of its line set. `null` where its
 * line doesn't start the block (it is inside a call's brackets on a line of code).
 */
export const setBlock = (source: string, at: number, kind: BlockKind): TextEdit[] | null => {
  const start = lineStart(source, at);
  const m = PREFIX.exec(source.slice(start, at));
  if (!m) return null;
  const marker =
    kind === "paragraph"
      ? ""
      : kind === "bullet"
        ? "- "
        : kind === "numbered"
          ? "+ "
          : `${"=".repeat(Number(kind.slice(1)))} `;
  const from = start + (m[1] as string).length;
  const to = from + (m[2] ?? "").length;
  if (source.slice(from, to) === marker) return [];
  return [{ from, to, insert: marker }];
};

/** What the marker at the start of `at`'s line makes the block. */
export const blockOf = (source: string, at: number): BlockKind => {
  const m = PREFIX.exec(source.slice(lineStart(source, at), at));
  const marker = m?.[2]?.trim() ?? "";
  if (marker.startsWith("=")) return marker.length === 1 ? "h1" : marker.length === 2 ? "h2" : "h3";
  if (marker === "-") return "bullet";
  if (marker === "+" || /^\d+\.$/.test(marker)) return "numbered";
  return "paragraph";
};

// --- code around edits ------------------------------------------------------------------

/** An embedded expression ending here: `#name`, `#a.b`, `#f(x)` (not an escaped `\#`). */
const CODE_END = /(?:^|[^\\])#[\p{L}_][\p{L}\p{N}_-]*(?:\.[\p{L}_][\p{L}\p{N}_-]*)*(?:\([^()\n]*\))?$/u;
/** What would go on with an expression before it: an identifier's characters, a field, a call. */
const CONTINUES = /^[\p{L}\p{N}_\-.(]/u;

/**
 * `edits` that leave an embedded expression (`#who`) followed by what would go on with it (`#whox`, `#who.`, after a
 * space between them was deleted) end it first with `;`, which Typst takes as its end and doesn't show. Text the code
 * shows has no source of its own, so typing beside it lands just after the expression.
 */
export const keepCode = (source: string, edits: readonly TextEdit[]): TextEdit[] =>
  edits.map((e) => {
    const next = e.insert || source.slice(e.to, e.to + 1);
    if (!CONTINUES.test(next) || !CODE_END.test(source.slice(Math.max(0, e.from - 200), e.from))) return e;
    // Another edit right after this one could still be what follows: only an edit's own text or the source after it.
    return { ...e, insert: `;${e.insert}` };
  });

// --- applying ---------------------------------------------------------------------------

/** `edits` (in the text's order, not overlapping) applied to `source`. */
export const applyEdits = (source: string, edits: readonly TextEdit[]): string => {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.from - a.from || b.to - a.to)) {
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  }
  return out;
};

/**
 * `edits` (in the text's coordinates, not overlapping) as one after another, each in the coordinates the ones before
 * it left: last first. What an engine document's `applyEdit` takes, and what positions are mapped through.
 */
export const sequential = (edits: readonly TextEdit[]): TextEdit[] =>
  [...edits].sort((a, b) => b.from - a.from || b.to - a.to);
