// The clipboard's two sides. Plain text is what a selection shows, for other programs: items and
// rows on lines, cells apart by tabs. Typst is for a paste here, so marks and blocks survive it:
// the selection made to stand on its own (a mark cut through is closed, or opened again).

import type { TextEdit } from "@typstream/core";
import { hasErrors, parse, type SyntaxNode } from "@typstream/syntax";
import {
  blockAtOffset,
  blocksAround,
  canType,
  type EditorSchema,
  emptyLineAt,
  fixedBlocks,
  guardDelimiters,
  insertText,
  isEmptyLine,
  splitBlock,
  unitsFor,
} from "./commands";
import { CURSOR, insertBlock } from "./components";
import { wrappers } from "./marks";
import { type EditorState, mapThrough } from "./state";
import { cellAt, tableAt } from "./table";
import { isWordy } from "./text";
import { blocksOf } from "./tree";
import { unitBefore } from "./units";

/**
 * What a piece shown whole gives as plain text: an equation its formula, a call the strings it
 * writes (`ce("H2O")`: H2O), never its Typst.
 */
const atomText = (source: string): string => {
  if (source.startsWith("$")) return source.slice(1, -1).trim();
  const strings = [...source.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] as string).replace(/\\(.)/g, "$1"));
  return strings.join(" ");
};

/**
 * The text a range shows (escapes resolved, markup's code left out), for copying as plain text:
 * paragraphs a blank line apart, list items and a table's rows on lines, its cells apart by tabs.
 */
export const shownText = (state: EditorState, from: number, to: number, schema: EditorSchema): string => {
  const units = unitsFor(state, schema);
  const text = state.text;
  let out = "";
  // What separates the text before from the text after: written once there is text after it, so
  // the selection neither starts nor ends with one.
  let gap = "";
  let cells = false;
  const put = (s: string) => {
    if (out) out += gap;
    gap = "";
    cells = false;
    out += s;
  };
  const apart = (s: string, cell = false) => {
    // A line break written in the text (`\`) is the line's end already.
    if (gap === "\n\n" || (s === " " && gap === "" && out.endsWith("\n"))) return;
    // Cells add up (an empty one is still a column); of anything else the widest counts.
    if (cell && (cells || gap === "")) gap += s;
    else if (s.length >= gap.length || s === "\n") gap = s;
    cells = cell;
  };
  let end = from;
  for (let i = Math.max(0, unitBefore(units, from)); i < units.length; i++) {
    const u = units[i];
    if (!u || u.from >= to) break;
    if (u.to <= from) continue;
    const t = text.slice(u.from, u.to);
    // Between a term and what it means, no unit: its colon.
    if (/^[ \t]*:[ \t]*$/.test(text.slice(end, u.from)) && out) put(": ");
    end = u.to;
    if (u.kind === "break") apart("\n\n");
    else if (u.kind === "space") {
      if (!t.includes("\n")) put(t.replace(/~/g, " "));
      // A line break in the source is a space, unless a list item's marker follows it.
      else apart((units[i + 1]?.from ?? u.to) > u.to ? "\n" : " ");
    } else if (u.kind === "edge") {
      // From one content argument to the next: a table's cells, a multiple choice's options.
      if (!t.startsWith("]") || !t.endsWith("[")) continue;
      const table = tableAt(state, u.to, schema);
      const cell = table && cellAt(table, u.to);
      apart(cell && cell.column > 0 ? "\t" : "\n", true);
    } else if (u.kind === "char") {
      if (t.startsWith("\\")) put(t.length === 2 && t[1] !== "\n" ? t.slice(1) : "\n");
      else if (t === "~") put(isEmptyLine(text, u.from) ? "" : " ");
      else put(t);
    } else if (u.kind === "atom") put(atomText(t));
  }
  return out;
};

/** Where a block's text starts: past a heading's or item's marker. */
const textStart = (state: EditorState, from: number, to: number, schema: EditorSchema): number => {
  const u = unitsFor(state, schema).find((x) => x.from >= from && x.kind !== "edge");
  return u && u.from <= to ? u.from : from;
};

/**
 * The selection as Typst that stands on its own, or `null` when it can't (it cuts through code).
 * Marks it starts or ends in come with it (`bo‸ld` of `*bold*` is bold), and a heading or item
 * copied from its first letter to its end is that block, marker and all.
 */
export const copiedTypst = (state: EditorState, from: number, to: number, schema: EditorSchema): string | null => {
  const text = state.text;
  const all = wrappers(state);
  // A mark selected to its edge: the whole of it, as written.
  for (let moved = true; moved; ) {
    moved = false;
    for (const w of all) {
      if (!w.delimiter && !schema.marks.has(w.name)) continue;
      if (w.innerFrom === from && to >= w.innerTo && w.from < from) {
        from = w.from;
        moved = true;
      }
      if (w.innerTo === to && from <= w.from && w.to > to) {
        to = w.to;
        moved = true;
      }
    }
  }
  let lead = "";
  const block = blockAtOffset(state, from, schema);
  if (
    block &&
    block.kind !== "paragraph" &&
    block.kind !== "expression" &&
    to >= block.to &&
    from > block.from &&
    from === textStart(state, block.from, block.to, schema)
  )
    lead = text.slice(block.from, from);
  let open = "";
  let close = "";
  const swaps: TextEdit[] = [];
  for (const w of all) {
    const starts = w.innerFrom <= from && from < w.innerTo;
    const ends = w.innerFrom < to && to <= w.innerTo;
    if (!starts && !ends) continue;
    // A mark around all of it styles it; anything else around it (a centred block) is where it was.
    if (starts && ends && !w.delimiter && !schema.marks.has(w.name)) continue;
    // Delimiters as calls: `*` beside a letter is a star.
    const o = w.delimiter ? `#${w.name}[` : text.slice(w.from, w.innerFrom);
    const c = w.delimiter ? "]" : text.slice(w.innerTo, w.to);
    if (starts) {
      open += o;
      if (!ends && w.delimiter) swaps.push({ from: w.innerTo, to: w.to, insert: c });
    }
    if (ends) {
      close = c + close;
      if (!starts && w.delimiter) swaps.push({ from: w.from, to: w.innerFrom, insert: o });
    }
  }
  let body = "";
  let at = from;
  for (const s of swaps.sort((a, b) => a.from - b.from)) {
    body += text.slice(at, s.from) + s.insert;
    at = s.to;
  }
  body += text.slice(at, to);
  const typst = lead + open + body + close;
  return hasErrors(parse(typst)) ? null : typst;
};

/** A line that starts a block: a heading's or list item's marker. */
const MARKER = /^[ \t]*(?:=+|[-+/]|\p{N}+\.)[ \t]+/u;

/** `typst` with a `*bold*` or `_emph_` at its start (`first`) or end (`last`) written as a call. */
const callForm = (typst: string, first: boolean, last: boolean): string => {
  const kids = parse(typst).children;
  const mark = (n: SyntaxNode | undefined) => (n && (n.kind === "Strong" || n.kind === "Emph") ? n : null);
  const head = first ? mark(kids[0]) : null;
  const tail = last ? mark(kids[kids.length - 1]) : null;
  let out = typst;
  for (const n of tail && tail !== head ? [tail, head] : [head]) {
    if (!n) continue;
    const name = n.kind === "Strong" ? "strong" : "emph";
    out = `${out.slice(0, n.from)}#${name}[${out.slice(n.from + 1, n.to - 1)}]${out.slice(n.to)}`;
  }
  return out;
};

/** Whether `typst` is blocks of their own and nothing else: components, tables, dividers. */
const isBlocks = (typst: string, schema: EditorSchema): boolean => {
  const blocks = blocksOf(parse(typst), typst, (name) => schema.inline.has(name));
  return blocks.length > 0 && blocks.every((b) => b.kind === "expression");
};

/**
 * Typst pasted at the caret. One block's line pasted into a line of text is its text (the marker
 * goes); on an empty line it is the block. Several lines pasted into a paragraph stand apart from
 * it. Components (a question, a table, a divider) go where one inserted there goes: on the empty
 * line, between a paragraph's halves, above a block at its start, else after the caret's block,
 * the caret after them. `null` where Typst can't go (code), where several lines can't (beside an
 * item's or a heading's text, in a cell: their text is pasted then), where a component can't (a
 * multiple choice's option, a mind map), or when the result wouldn't parse.
 */
export const pasteTypst = (state: EditorState, source: string, schema: EditorSchema): EditorState | null => {
  let typst = source.replace(/\n+$/, "");
  const head = state.selection.head;
  if (!typst || !state.empty || hasErrors(parse(typst))) return null;
  if (isBlocks(typst, schema)) {
    if (typst.includes(CURSOR) || fixedBlocks(state, head, schema)) return null;
    const placed = state.apply(insertBlock(typst)(state, schema)).state;
    const end = placed.to;
    const next = placed.select({ anchor: end, head: end });
    return hasErrors(next.tree) && !hasErrors(state.tree) ? null : next;
  }
  if (!canType(state, head)) return null;
  const text = state.text;
  let from = head;
  let to = head;
  const lineStart = text.lastIndexOf("\n", head - 1) + 1;
  const eol = text.indexOf("\n", head);
  const before = text.slice(lineStart, head);
  const after = text.slice(head, eol < 0 ? text.length : eol);
  const empty = emptyLineAt(text, head);
  let lead = "";
  let trail = "";
  if (empty >= 0) {
    // An empty line's `~` goes, as when text is typed there.
    from = empty;
    to = empty + 1;
  } else if (before.trim() !== "" || after.trim() !== "") {
    if (!typst.includes("\n")) typst = typst.replace(MARKER, "");
    else if (blocksAround(state, head, schema).markup !== state.tree || MARKER.test(before)) return null;
    else {
      if (before.trim() !== "") lead = "\n\n";
      if (after.trim() !== "") trail = "\n\n";
    }
  }
  if (!lead && !trail) typst = callForm(typst, isWordy(text[from - 1]), isWordy(text[to]) && !typst.includes("\n"));
  const edit = { from, to, insert: lead + typst + trail };
  const edits = [edit, ...guardDelimiters(state, [edit])].sort((a, b) => a.from - b.from || a.to - b.to);
  const at = mapThrough(from, edits, -1) + lead.length + typst.length;
  const next = state.apply({ edits, selection: { anchor: at, head: at } }).state;
  return hasErrors(next.tree) && !hasErrors(state.tree) ? null : next;
};

/**
 * Plain text pasted at the caret, as if typed: every line a paragraph (in a list, an item), its
 * characters escaped. `null` where text can't be typed, or there is none.
 */
export const pastePlain = (state: EditorState, plain: string, schema: EditorSchema): EditorState | null => {
  const lines = plain
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\t/g, " ").trim())
    .filter((l) => l !== "");
  let s = state;
  for (const [i, line] of lines.entries()) {
    if (i > 0) {
      const split = splitBlock(s, schema);
      if (split) s = s.apply(split).state;
    }
    const tr = insertText(line)(s, schema);
    if (!tr) return i === 0 ? null : s;
    s = s.apply(tr).state;
  }
  return lines.length ? s : null;
};
