// Editing commands: what typing, Backspace, Enter and the toolbars do to the source. Each reads
// Typst's syntax tree and returns the edits that make the change, keeping the source valid and
// everything the change doesn't touch byte for byte (the author's or the model's formatting,
// comments and code). The teacher sees and edits the pages; this is how that becomes Typst.

import type { TextEdit } from "@typstream/core";
import type { SyntaxNode } from "@typstream/syntax";
import { type EditorState, mapThrough, type Selection, type Transaction } from "./state";
import { atLineStart, escapeMarkup, isWordy } from "./text";
import {
  type Block,
  blocksOf,
  calleeName,
  contentBlocksIn,
  findLast,
  isEmbedded,
  itemAt,
  markupOf,
  type Path,
  pathAt,
} from "./tree";
import { step, type Unit, unitAfter, unitBefore, unitInside, unitsOf } from "./units";

/**
 * What the commands need to know beyond the state: which calls are marks (text styling, shown
 * inline and stepped over like `*`) and which are set inline in a paragraph.
 * @beta
 */
export interface EditorSchema {
  /** Calls that style the text inside them (`strong`, `text`, `underline`): their code shows nothing. */
  marks: ReadonlySet<string>;
  /** Calls set inline in a paragraph even alone on a line. */
  inline: ReadonlySet<string>;
}

/** The marks and inline calls of Typst's standard library. @beta */
export const DEFAULT_SCHEMA: EditorSchema = {
  marks: new Set([
    "strong",
    "emph",
    "underline",
    "overline",
    "strike",
    "highlight",
    "sub",
    "super",
    "smallcaps",
    "text",
    "link",
    "lower",
    "upper",
  ]),
  inline: new Set([
    "strong",
    "emph",
    "underline",
    "overline",
    "strike",
    "highlight",
    "sub",
    "super",
    "smallcaps",
    "text",
    "link",
    "box",
    "raw",
    "ref",
    "cite",
    "footnote",
    "h",
    "sym",
    "emoji",
    "lower",
    "upper",
  ]),
};

/**
 * A state's derived data commands share: its units (cached per state).
 * @beta
 */
export const unitsFor = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Unit[] => {
  const cache = state as EditorState & { [UNITS]?: { schema: EditorSchema; units: Unit[] } };
  const hit = cache[UNITS];
  if (hit && hit.schema === schema) return hit.units;
  const units = unitsOf(state.tree, state.text, (name) => schema.marks.has(name));
  cache[UNITS] = { schema, units };
  return units;
};
const UNITS = Symbol("units");

/** The blocks of the markup around `offset`. */
export const blocksAround = (state: EditorState, offset: number, schema: EditorSchema = DEFAULT_SCHEMA) => {
  const path = pathAt(state.tree, offset, -1);
  const m = markupAround(path, offset) ?? { markup: state.tree, index: 0 };
  const blocks = blocksOf(m.markup, state.text, (name) => schema.inline.has(name));
  return { path, markup: m.markup, blocks };
};

/**
 * The markup a caret at `offset` types into: the innermost `Markup` on the path that contains it,
 * skipping a heading's or list item's own markup when the offset is outside its text.
 */
const markupAround = (path: Path, offset: number): { markup: SyntaxNode; index: number } | null => {
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i] as SyntaxNode;
    if (n.kind === "Markup" && n.from <= offset && offset <= n.to) {
      // A block item's own markup is its text; blocks are its parent's.
      const parent = path[i - 1];
      if (
        parent &&
        (parent.kind === "Heading" ||
          parent.kind === "ListItem" ||
          parent.kind === "EnumItem" ||
          parent.kind === "TermItem")
      )
        continue;
      if (parent && (parent.kind === "Strong" || parent.kind === "Emph")) continue;
      return { markup: n, index: i };
    }
  }
  return markupOf(path);
};

/** An empty transaction that just selects. */
const selectOnly = (selection: Selection): Transaction => ({ edits: [], selection });

const caret = (at: number): Selection => ({ anchor: at, head: at });

/** Whether `offset` is where a caret can type: in markup, not inside code, math or a string. */
export const canType = (state: EditorState, offset: number): boolean => {
  const after = pathAt(state.tree, offset, 1);
  const before = pathAt(state.tree, offset, -1);
  return typingContext(after) !== null || typingContext(before) !== null;
};

/** `markup` or `raw` when a caret on `path` types text there. */
const typingContext = (path: Path): "markup" | "raw" | null => {
  for (let i = path.length - 1; i >= 0; i--) {
    const kind = (path[i] as SyntaxNode).kind;
    if (kind === "Raw") {
      const leaf = path[path.length - 1] as SyntaxNode;
      return leaf.kind === "RawDelim" || leaf.kind === "RawLang" ? null : "raw";
    }
    if (kind === "Markup") return "markup";
    if (
      kind === "Math" ||
      kind === "Code" ||
      kind === "Args" ||
      kind === "CodeBlock" ||
      kind === "Str" ||
      kind === "Equation"
    )
      return null;
    if (kind === "Hash" || kind === "Ident" || kind === "FuncCall" || kind === "FieldAccess") return null;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Deleting

const TEXTY = new Set(["Text", "Space"]);

/**
 * The edits that delete `[from, to)` structurally: text inside it goes; a construct (strong text,
 * a call, a list item's marker) goes only when all of it is inside, so the source stays valid; a
 * heading's or list item's marker goes when the range starts before it (the block joins the one
 * before, as in word processors).
 * @beta
 */
export const deleteEdits = (
  state: EditorState,
  from: number,
  to: number,
  schema: EditorSchema = DEFAULT_SCHEMA,
): TextEdit[] => {
  const text = state.text;
  const edits: TextEdit[] = [];
  const push = (a: number, b: number) => {
    if (b <= a) return;
    const last = edits[edits.length - 1];
    if (last && last.to >= a) last.to = Math.max(last.to, b);
    else edits.push({ from: a, to: b, insert: "" });
  };
  const inside = (n: SyntaxNode) => from <= n.from && n.to <= to;
  const visit = (node: SyntaxNode, markup: boolean) => {
    if (node.to <= from || node.from >= to) return;
    if (inside(node) && node.kind !== "Markup") {
      push(node.from, node.to);
      return;
    }
    if (node.children.length === 0) {
      if ((markup && TEXTY.has(node.kind)) || (node.kind === "Text" && !markup))
        push(Math.max(from, node.from), Math.min(to, node.to));
      else if (node.kind === "Text" || node.kind === "RawTrimmed")
        push(Math.max(from, node.from), Math.min(to, node.to));
      return;
    }
    const kids = node.children;
    switch (node.kind) {
      case "Markup":
        for (let i = 0; i < kids.length; i++) {
          const c = kids[i] as SyntaxNode;
          const expr = kids[i + 1];
          if (c.kind === "Hash" && expr && isEmbedded(expr)) {
            i++;
            if (from <= c.from && expr.to <= to) push(c.from, expr.to);
            else embedded(c, expr);
          } else visit(c, true);
        }
        return;
      case "Strong":
      case "Emph": {
        const inner = kids.find((k) => k.kind === "Markup");
        // All of its text inside the range: the delimiters go too.
        if (inner && from <= inner.from && inner.to <= to) push(node.from, node.to);
        else if (inner) visit(inner, true);
        return;
      }
      case "Heading":
      case "ListItem":
      case "EnumItem":
      case "TermItem": {
        const marker = kids[0] as SyntaxNode;
        const body = kids.find((k) => k.kind === "Markup");
        if (from < marker.from && to >= (body?.from ?? marker.to)) push(marker.from, body?.from ?? marker.to);
        for (const k of kids) if (k.kind === "Markup") visit(k, true);
        return;
      }
      case "Raw":
        for (const k of kids) if (k.kind === "Text") visit(k, false);
        return;
      case "Equation":
        // An equation is one piece: partly selected, it goes whole.
        push(node.from, node.to);
        return;
      default:
        for (const k of kids)
          if (k.kind === "ContentBlock" || k.kind === "Markup" || k.kind === "Args") visit(k, k.kind === "Markup");
    }
  };
  /** An embedded expression partly in the range: only the text in its content blocks goes, unless it is a mark. */
  const embedded = (hash: SyntaxNode, expr: SyntaxNode) => {
    const name = expr.kind === "FuncCall" ? calleeName(expr, text) : null;
    const blocks = contentBlocksIn(expr);
    if (blocks.length === 0 && (from <= hash.from || to >= expr.to)) {
      // Shown whole (an image, an inline equation call): partly selected, it goes whole.
      if (name !== null && !schema.marks.has(name) && from > hash.from && to < expr.to) return;
      push(hash.from, expr.to);
      return;
    }
    // A mark whose text is all inside the range goes whole.
    if (name !== null && schema.marks.has(name) && blocks.length === 1) {
      const inner = (blocks[0] as SyntaxNode).children.find((k) => k.kind === "Markup");
      if (inner && from <= inner.from && inner.to <= to) {
        push(hash.from, expr.to);
        return;
      }
    }
    for (const b of blocks) {
      const inner = b.children.find((k) => k.kind === "Markup");
      if (inner) visit(inner, true);
    }
  };
  visit(state.tree, true);
  return [...edits, ...guardDelimiters(state, edits)];
};

/** Deletes the selection; `null` when it is a caret. @beta */
export const deleteSelection = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
  if (state.empty) return null;
  const edits = deleteEdits(state, state.from, state.to, schema);
  return { edits, selection: caret(state.from) };
};

/**
 * Backspace (`dir` -1) or Delete (1). With a selection, deletes it. Otherwise one unit: a
 * character, a space, the break between two paragraphs (they join). At the start of a heading or
 * list item, Backspace first makes it a paragraph. An atom (an equation, a component) is selected
 * first, and deleted by the next press.
 * @beta
 */
export const deleteChar =
  (dir: 1 | -1) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    if (!state.empty) return deleteSelection(state, schema);
    const at = state.selection.head;
    const units = unitsFor(state, schema);
    if (dir < 0) {
      const item = itemAt(state.tree, state.text, at);
      const body = item?.children.find((k) => k.kind === "Markup");
      if (item && (!body || body.from === body.to || body.from >= at)) {
        const edits = unmark(state, item);
        return { edits, selection: caret(mapThrough(at, edits, -1)) };
      }
    }
    const i = dir < 0 ? unitBefore(units, at) : unitAfter(units, at);
    const u = units[i];
    if (!u) return null;
    // Nothing but delimiters may lie between the caret and the unit: never another unit's code.
    if (u.kind === "edge") return null;
    if (u.kind === "atom") return selectOnly({ anchor: u.from, head: u.to, node: true });
    const [from, to] = u.kind === "break" ? [Math.min(at, u.from), Math.max(at, u.to)] : [u.from, u.to];
    const edits = deleteEdits(state, from, to, schema);
    return { edits, selection: caret(mapThrough(dir < 0 ? from : at, edits, -1)) };
  };

/** Edits that turn a heading or list item into a paragraph: its marker goes, and it stays a block of its own. */
const unmark = (state: EditorState, item: SyntaxNode): TextEdit[] => {
  const body = item.children.find((k) => k.kind === "Markup");
  const end = body?.from ?? item.to;
  const text = state.text;
  const edits: TextEdit[] = [{ from: item.from, to: end, insert: "" }];
  const lineStart = text.lastIndexOf("\n", item.from - 1);
  // The text before on the previous line would run into it: a blank line keeps them apart.
  if (
    lineStart > 0 &&
    text[lineStart - 1] !== "\n" &&
    text.slice(lineStart + 1, item.from).trim() === "" &&
    item.kind !== "ListItem" &&
    item.kind !== "EnumItem"
  )
    edits.unshift({ from: lineStart, to: lineStart, insert: "\n" });
  const after = text.indexOf("\n", item.to);
  if (item.kind === "Heading" && after >= 0 && text[after + 1] !== "\n" && after + 1 < text.length)
    edits.push({ from: after, to: after, insert: "\n" });
  return edits;
};

// ---------------------------------------------------------------------------
// Typing

/**
 * Types `typed` over the selection: escaped for Typst so it shows as typed (a `*` is a star). In
 * raw text it goes in as it is. A space that Typst would fold into the one before it is a
 * non-breaking space, so double spaces show. `null` where text can't be typed (code, math).
 * @beta
 */
export const insertText =
  (typed: string) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    if (state.selection.node) return null;
    const from = state.from;
    const to = state.to;
    const deletions = from < to ? deleteEdits(state, from, to, schema) : [];
    // Where the text goes: the selection's start, after what is deleted there.
    const path = pathAt(state.tree, from, 1);
    const ctx = typingContext(path) ?? typingContext(pathAt(state.tree, from, -1));
    if (ctx === null) return null;
    const text = state.text;
    let insert = typed;
    if (ctx === "markup") {
      const lineStart = text.lastIndexOf("\n", from - 1) + 1;
      const before = text.slice(lineStart, from);
      const afterEnd = deletions.length ? (deletions[deletions.length - 1] as TextEdit).to : to;
      const after = text.slice(afterEnd, afterEnd + 4);
      insert = escapeMarkup(typed.replace(/\r\n?/g, "\n"), before, after);
      if (typed === " " && (/\s$/.test(before) || atLineStart(before) || before.endsWith("~"))) insert = "~";
    } else if (ctx === "raw") {
      insert = typed.replace(/`/g, "ˋ");
    }
    const edits: TextEdit[] = [...deletions.filter((d) => d.to <= from || d.from >= from)];
    const at = from;
    // Insert at the start of the deleted range (merged into an edit starting there).
    const first = edits.find((e) => e.from === at);
    if (first) first.insert = insert + first.insert;
    else edits.push({ from: at, to: at, insert });
    const all = dedupe(edits);
    const guarded = [...all, ...guardDelimiters(state, all)];
    // After the typed text: where `at` goes, before what was inserted there, plus the text.
    const head =
      mapThrough(
        at,
        dedupe(guarded).sort((a, b) => a.from - b.from || a.to - b.to),
        -1,
      ) + insert.length;
    return { edits: dedupe(guarded), selection: caret(head), merge: true };
  };

const dedupe = (edits: TextEdit[]): TextEdit[] => {
  const seen = new Set<string>();
  return edits.filter((e) => {
    const k = `${e.from}:${e.to}:${e.insert}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Text typed or deleted next to a `*` or `_` delimiter can turn it into text: Typst reads one
 * between two letters as text (lexer.rs `in_word`). Strong or emph text whose delimiter would end
 * up so becomes `#strong[…]` / `#emph[…]`, which reads the same anywhere.
 */
const guardDelimiters = (state: EditorState, edits: readonly TextEdit[]): TextEdit[] => {
  if (edits.length === 0) return [];
  const text = state.text;
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  let next = "";
  let at = 0;
  for (const e of sorted) {
    next += text.slice(at, e.from) + e.insert;
    at = e.to;
  }
  next += text.slice(at);
  const touched = (pos: number) => sorted.some((e) => e.from <= pos + 1 && pos - 1 <= e.to);
  const deleted = (a: number, b: number) => sorted.some((e) => e.from < b && a < e.to);
  const inWord = (pos: number) => isWordy(next[pos - 1]) && isWordy(next[pos + 1]);
  const start = (sorted[0] as TextEdit).from;
  const end = (sorted[sorted.length - 1] as TextEdit).to;
  const out: TextEdit[] = [];
  const visit = (node: SyntaxNode) => {
    if (node.kind === "Strong" || node.kind === "Emph") {
      const open = node.from;
      const close = node.to - 1;
      if ((touched(open) || touched(close)) && !deleted(open, open + 1) && !deleted(close, close + 1)) {
        const o = mapThrough(open, sorted, 1);
        const c = mapThrough(close, sorted, 1);
        if (inWord(o) || inWord(c)) {
          const name = node.kind === "Strong" ? "strong" : "emph";
          out.push({ from: open, to: open + 1, insert: `#${name}[` }, { from: close, to: close + 1, insert: "]" });
          return;
        }
      }
    }
    for (const c of node.children) if (c.to >= start - 1 && c.from <= end + 1) visit(c);
  };
  visit(state.tree);
  // Only those that don't overlap the edits themselves.
  return out.filter((g) => !sorted.some((e) => e.from < g.to && g.from < e.to));
};

// ---------------------------------------------------------------------------
// Enter

/** The column `offset` is at on its line. */
const column = (text: string, offset: number): number => offset - (text.lastIndexOf("\n", offset - 1) + 1);

/**
 * Enter: a new paragraph, or in a list a new item. In an empty list item, ends the list. At the
 * start of a heading or item with text, the new block goes before it.
 * @beta
 */
export const splitBlock = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
  let base = state;
  const pre: TextEdit[] = [];
  if (!state.empty) {
    const del = deleteSelection(state, schema);
    if (!del) return null;
    const applied = state.apply(del);
    base = applied.state;
    if (applied.edit) pre.push(applied.edit);
  }
  const at = base.selection.head;
  if (!canType(base, at)) return null;
  const text = base.text;
  const path = pathAt(base.tree, at, -1);
  const found = itemAt(base.tree, text, at);
  const item = found && found.kind !== "Heading" ? found : null;
  let tr: Transaction;
  if (item && item.from < at) {
    const marker = item.children[0] as SyntaxNode;
    const body = item.children.find((k) => k.kind === "Markup");
    const empty = !body || text.slice(body.from, body.to).trim() === "";
    if (empty) {
      // An empty item ends the list: it becomes an empty paragraph after it.
      const lineStart = text.lastIndexOf("\n", item.from - 1) + 1;
      let end = item.to;
      while (text[end] === " " || text[end] === "\t") end++;
      tr = { edits: [{ from: lineStart, to: end, insert: "\n" }], selection: caret(lineStart + 1) };
    } else if (body && at <= body.from) {
      // At the start of the item's text: an empty item before it.
      const indent = " ".repeat(column(text, item.from));
      const markerText = item.kind === "EnumItem" ? "+" : text.slice(marker.from, marker.to);
      const insert = `${markerText} \n${indent}`;
      tr = { edits: [{ from: item.from, to: item.from, insert }], selection: caret(item.from + insert.length) };
    } else {
      const indent = " ".repeat(column(text, item.from));
      const markerText =
        item.kind === "EnumItem" ? "+" : item.kind === "TermItem" ? "/" : text.slice(marker.from, marker.to);
      const insert = item.kind === "TermItem" ? `\n${indent}/ ` : `\n${indent}${markerText} `;
      // The rest of the line's spaces stay with the text after the break, not before.
      tr = { edits: [{ from: at, to: at, insert }], selection: caret(at + insert.length) };
    }
  } else {
    const isHeading = (n: SyntaxNode) => n.kind === "Heading";
    const heading = findLast(path, isHeading) ?? findLast(pathAt(base.tree, at, 1), isHeading);
    const body = heading?.children.find((k) => k.kind === "Markup");
    if (heading && body && at <= body.from) {
      tr = { edits: [{ from: heading.from, to: heading.from, insert: "\n\n" }], selection: caret(at + 2) };
    } else {
      // Spaces around the break would start or end a paragraph: they go.
      let a = at;
      let b = at;
      while (a > 0 && (text[a - 1] === " " || text[a - 1] === "\t")) a--;
      while (b < text.length && (text[b] === " " || text[b] === "\t")) b++;
      const indent = " ".repeat(Math.max(0, indentOf(text, at)));
      const insert = `\n\n${indent}`;
      tr = { edits: [{ from: a, to: b, insert }], selection: caret(a + insert.length) };
    }
  }
  if (pre.length === 0) return tr;
  return chain(state, base, tr);
};

/** How far the line at `offset` is indented (content blocks written over several lines keep it). */
const indentOf = (text: string, offset: number): number => {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  let i = lineStart;
  while (text[i] === " ") i++;
  return i - lineStart;
};

/**
 * Shift+Enter: a line break in the paragraph (Typst's `\`).
 * @beta
 */
export const insertLineBreak = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
  const base = state.empty ? null : deleteSelection(state, schema);
  const s = base ? state.apply(base).state : state;
  const at = s.selection.head;
  if (!canType(s, at)) return null;
  const insert = s.text[at - 1] === " " ? "\\ " : " \\ ";
  const tr: Transaction = { edits: [{ from: at, to: at, insert }], selection: caret(at + insert.length) };
  return base ? chain(state, s, tr) : tr;
};

/**
 * One transaction from `state` to `mid` (edits already made) and on through `tr`: what was
 * replaced in `state` by everything, as a single edit.
 */
const chain = (state: EditorState, mid: EditorState, tr: Transaction): Transaction => {
  const { state: end } = mid.apply(tr);
  const edit = diff(state.text, end.text);
  return { edits: edit ? [edit] : [], selection: end.selection };
};

const diff = (a: string, b: string): TextEdit | null => {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
};

// ---------------------------------------------------------------------------
// Caret movement over units

/**
 * Where a caret at `offset` moves one unit left (-1) or right (1); `offset` itself at the end.
 * @beta
 */
export const moveChar = (
  state: EditorState,
  offset: number,
  dir: 1 | -1,
  schema: EditorSchema = DEFAULT_SCHEMA,
): number => step(unitsFor(state, schema), offset, dir);

/**
 * Snaps `offset` to a place a caret can be: not inside a character, an atom or a component's code.
 * @beta
 */
export const snap = (state: EditorState, offset: number, schema: EditorSchema = DEFAULT_SCHEMA): number => {
  const units = unitsFor(state, schema);
  const inside = unitInside(units, offset);
  if (inside) return offset - inside.from < inside.to - offset ? inside.from : inside.to;
  return offset;
};

/** The units, for views that need them. @beta */
export const unitsAt = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): readonly Unit[] =>
  unitsFor(state, schema);

/** The block (in the innermost markup) holding `offset`. @beta */
export const blockAtOffset = (
  state: EditorState,
  offset: number,
  schema: EditorSchema = DEFAULT_SCHEMA,
): Block | null => {
  const { blocks } = blocksAround(state, offset, schema);
  let found: Block | null = null;
  for (const b of blocks) {
    if (b.from <= offset && offset <= b.to) return b;
    if (b.from <= offset) found = b;
  }
  return found;
};
