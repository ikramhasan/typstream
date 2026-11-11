// Editing commands: what typing, Backspace, Enter and the toolbars do to the source. Each reads
// Typst's syntax tree and returns the edits that make the change, keeping the source valid and
// everything the change doesn't touch byte for byte (the author's or the model's formatting,
// comments and code). The teacher sees and edits the pages; this is how that becomes Typst.

import type { TextEdit } from "@typstream/core";
import type { SyntaxNode } from "@typstream/syntax";
import { componentAt, componentsAt, deleteBlock } from "./components";
import { type EditorState, mapThrough, type Selection, type Transaction } from "./state";
import { atLineStart, EMPTY_LINE, escapeMarkup, isWordy } from "./text";
import {
  type Block,
  blocksOf,
  bodyStart,
  calleeName,
  contentBlocksIn,
  findLast,
  ITEM_NODES,
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
  /** Components a plugin declares (with forms), whose content the editor's keys know. */
  components?: ReadonlySet<string>;
  /** Components whose positional content arguments are items (a multiple choice's options). */
  lists?: ReadonlySet<string>;
  /**
   * By list component, the named argument that numbers one of its items (a multiple choice's
   * `answer`): it follows its item as items are added and removed.
   */
  indexes?: ReadonlyMap<string, string>;
  /** Components whose positional arguments are rows of content cells (a rubric's criteria). */
  rows?: ReadonlySet<string>;
  /**
   * Components whose content is an outline, a first line and the list under it (a mind map's topic
   * and branches): the keys keep it one.
   */
  outlines?: ReadonlySet<string>;
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

/** The blocks of the markup around `offset` (the innermost that reaches `to` as well). */
export const blocksAround = (
  state: EditorState,
  offset: number,
  schema: EditorSchema = DEFAULT_SCHEMA,
  to: number = offset,
) => {
  const path = pathAt(state.tree, offset, -1);
  const styled = (call: SyntaxNode) => schema.marks.has(calleeName(call, state.text) ?? "");
  const m = markupAround(path, offset, styled, to) ?? { markup: state.tree, index: 0 };
  const blocks = blocksOf(m.markup, state.text, (name) => schema.inline.has(name));
  return { path, markup: m.markup, blocks };
};

/**
 * The markup a caret at `offset` types into: the innermost `Markup` on the path that contains it,
 * skipping a heading's or list item's own markup when the offset is outside its text, and the text
 * of a mark (`*…*`, `#underline[…]`, a colour): a block is the paragraph the styled words are in.
 */
const markupAround = (
  path: Path,
  offset: number,
  styled: (call: SyntaxNode) => boolean = () => false,
  to: number = offset,
): { markup: SyntaxNode; index: number } | null => {
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i] as SyntaxNode;
    if (n.kind === "Markup" && n.from <= offset && to <= n.to) {
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
      // A mark written as a call, around words of one paragraph (around whole paragraphs, its
      // content has blocks of its own).
      const call = path[i - 3];
      if (
        parent?.kind === "ContentBlock" &&
        call?.kind === "FuncCall" &&
        styled(call) &&
        !n.children.some((k) => k.kind === "Parbreak" || ITEM_NODES.has(k.kind))
      )
        continue;
      return { markup: n, index: i };
    }
  }
  return markupOf(path);
};

/** An empty transaction that just selects. */
const selectOnly = (selection: Selection): Transaction => ({ edits: [], selection });

/** The component whose content `at` is in, with that content block: the innermost. */
const contentAt = (state: EditorState, at: number, schema: EditorSchema) => {
  for (const c of componentsAt(state, at, schema)) {
    const block = contentBlocksIn(c.call).find((b) => b.from < at && at < b.to);
    if (block) return { name: c.name, block };
  }
  return null;
};

/** Whether `at` is in an outline's content (`EditorSchema.outlines`), not in a component inside it. */
const inOutline = (state: EditorState, at: number, schema: EditorSchema): boolean =>
  !!schema.outlines?.size && schema.outlines.has(contentAt(state, at, schema)?.name ?? "");

/**
 * Whether the component around `at` decides what its content's blocks are: an item of a list
 * component (a multiple choice's option is a line of text) or an outline (a mind map's topic and
 * branches). No heading or list is made there.
 * @internal
 */
export const fixedBlocks = (state: EditorState, at: number, schema: EditorSchema): boolean => {
  const name = contentAt(state, at, schema)?.name ?? "";
  return (schema.lists?.has(name) ?? false) || (schema.outlines?.has(name) ?? false);
};

const caret = (at: number): Selection => ({ anchor: at, head: at });

/** Whether `offset` is where a caret can type: in markup, not inside code, math or a string. @beta */
export const canType = (state: EditorState, offset: number): boolean => {
  const after = pathAt(state.tree, offset, 1);
  const before = pathAt(state.tree, offset, -1);
  return typingContext(after) !== null || typingContext(before) !== null || atSeam(state.tree, offset);
};

/** What a caret at `at` types into: the text after it, else the text before it, else a seam's markup. */
const contextAt = (root: SyntaxNode, at: number, first: 1 | -1 = 1): "markup" | "raw" | null =>
  typingContext(pathAt(root, at, first)) ?? typingContext(pathAt(root, at, -1)) ?? (atSeam(root, at) ? "markup" : null);

/**
 * Whether `at` is between two pieces of markup that are code on both sides, or between one and
 * its content's edge (`[$x$‸]`, `[‸#blank()]`, `$a$‸$b$`): text typed there is markup's, though
 * the nodes beside the caret are an equation's or a call's.
 */
const atSeam = (root: SyntaxNode, at: number): boolean => {
  let node = root;
  for (let next: SyntaxNode | undefined = root; next; ) {
    node = next;
    next = node.children.find((k) => k.from < at && at < k.to);
  }
  // Between `#` and what it embeds is code.
  if (node.kind === "Markup") return node.children.find((k) => k.to === at)?.kind !== "Hash";
  if (node.kind !== "ContentBlock" && node.kind !== "Strong" && node.kind !== "Emph" && !ITEM_NODES.has(node.kind))
    return false;
  return node.children.some((k) => k.kind === "Markup" && k.from <= at && at <= k.to);
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
 * before, as in word processors). With `typing`, text is about to go in at `from`: a mark whose
 * text starts there stays, for the typed text to have (bold words typed over stay bold).
 * @beta
 */
export const deleteEdits = (
  state: EditorState,
  from: number,
  to: number,
  schema: EditorSchema = DEFAULT_SCHEMA,
  typing = false,
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
  // Line breaks that stay: those around a component the range only reaches into (from the
  // paragraph before a table into its first cell), so its call stays on a line of its own.
  const kept: [number, number][] = [];
  const keepLine = (n: SyntaxNode | undefined) => {
    if (n && (n.kind === "Space" || n.kind === "Parbreak") && text.slice(n.from, n.to).includes("\n"))
      kept.push([n.from, n.to]);
  };
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
            // Only an expression the range reaches: one before or after it stays whole.
            if (expr.to <= from || c.from >= to) continue;
            if (from <= c.from && expr.to <= to) push(c.from, expr.to);
            else {
              embedded(c, expr);
              const name = expr.kind === "FuncCall" ? calleeName(expr, text) : null;
              if (contentBlocksIn(expr).length > 0 && !(name !== null && schema.marks.has(name))) {
                if (from < c.from) keepLine(kids[i - 2]);
                if (to > expr.to) keepLine(kids[i + 1]);
              }
            }
          } else visit(c, true);
        }
        return;
      case "Strong":
      case "Emph": {
        const inner = kids.find((k) => k.kind === "Markup");
        // All of its text inside the range: the delimiters go too.
        if (inner && from <= inner.from && inner.to <= to && !(typing && from === inner.from)) push(node.from, node.to);
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
      if (inner && from <= inner.from && inner.to <= to && !(typing && from === inner.from)) {
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
  let left = edits;
  for (const [a, b] of kept)
    left = left.flatMap((e) =>
      e.to <= a || e.from >= b
        ? [e]
        : [
            ...(e.from < a ? [{ from: e.from, to: a, insert: "" }] : []),
            ...(e.to > b ? [{ from: b, to: e.to, insert: "" }] : []),
          ],
    );
  return [...left, ...guardDelimiters(state, left)];
};

/** Deletes the selection; `null` when it is a caret. @beta */
export const deleteSelection = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
  if (state.empty) return null;
  // A component or equation selected: it goes with the line it leaves.
  if (state.selection.node) return deleteBlock(state.from, state.to)(state, schema);
  const edits = keepCells(state, deleteEdits(state, state.from, state.to, schema), schema);
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
    // At a heading's or item's text start, the empty line above it counts as beside the caret.
    const startItem = dir < 0 ? itemAt(state.tree, state.text, at) : null;
    const startBody = startItem?.children.find((k) => k.kind === "Markup");
    const lineAt = startItem && (!startBody || startBody.from >= at) ? startItem.from : at;
    const line = removeEmptyLine(state, lineAt, dir);
    // Removed above a heading: the caret stays at its text.
    if (line && lineAt !== at && line.edits.length)
      return { edits: line.edits, selection: caret(mapThrough(at, line.edits, 1)) };
    if (line !== undefined) return line;
    // On a line left empty (its text deleted): the line goes, not a character of the text above.
    if (inEmptyParagraph(state.text, at) && !itemAt(state.tree, state.text, at)) {
      const text = state.text;
      let from = text.lastIndexOf("\n", at - 1) + 1;
      while (from > 0 && /\s/.test(text[from - 1] as string)) from--;
      const eol = text.indexOf("\n", at);
      const to = eol < 0 ? text.length : eol;
      // At the very start, the blank lines after it go instead.
      if (from === 0 || text[from - 1] === "[") {
        let end = to;
        while (end < text.length && /\s/.test(text[end] as string)) end++;
        if (text[end] === "]") end = to;
        return {
          edits: [{ from: text.lastIndexOf("\n", at - 1) + 1, to: end, insert: "" }],
          selection: caret(text.lastIndexOf("\n", at - 1) + 1),
        };
      }
      return { edits: [{ from, to, insert: "" }], selection: caret(from) };
    }
    if (dir < 0) {
      const item = itemAt(state.tree, state.text, at);
      const body = item?.children.find((k) => k.kind === "Markup");
      if (item && (!body || body.from === body.to || body.from >= at)) {
        // At an item's start, as in a word processor: a nested item goes up a level, an empty one
        // becomes an empty paragraph after the list, and one with text a paragraph.
        const up = outdentItem(state, item, at);
        if (up) return up;
        if (item.kind !== "Heading" && inOutline(state, at, schema)) return joinBranch(state, item, at);
        if (item.kind !== "Heading" && isEmptyItem(state.text, item)) return leaveList(state.text, item);
        const edits = unmark(state, item);
        return { edits, selection: caret(mapThrough(at, edits, -1)) };
      }
    }
    const unaligned = dir < 0 ? unalign(state, at) : null;
    if (unaligned) return unaligned;
    const unbroken = deleteLineBreak(state, at, dir, schema);
    if (unbroken) return unbroken;
    // A caret inside a run of whitespace (a paragraph's last space, which Typst's parser keeps in
    // the break after it): the space beside the caret, not the character before the run.
    const within = unitInside(units, at);
    const text = state.text;
    if (within && (within.kind === "break" || within.kind === "space")) {
      const c = dir < 0 ? text[at - 1] : text[at];
      if (c === " " || c === "\t") {
        const edits = [dir < 0 ? { from: at - 1, to: at, insert: "" } : { from: at, to: at + 1, insert: "" }];
        return { edits, selection: caret(dir < 0 ? at - 1 : at) };
      }
    }
    const i = dir < 0 ? unitBefore(units, at) : unitAfter(units, at);
    const u = units[i];
    if (!u) return null;
    // Nothing but delimiters may lie between the caret and the unit: never another unit's code.
    // Right after a component (or right before one), it is selected, as an atom is.
    if (u.kind === "edge") {
      const beside = componentsAt(state, at, schema).find((c) => (dir < 0 ? c.to === at : c.from === at));
      return beside ? selectOnly({ anchor: beside.from, head: beside.to, node: true }) : null;
    }
    // Across the break to a component or an equation on its own: it is selected, as an atom is
    // (the next press deletes it), not joined to the text. Across a line's end too, to a component
    // on the next line (a question's text, then its options).
    const lines = text.slice(u.from, u.to).includes("\n");
    if (u.kind === "break" || (u.kind === "space" && lines)) {
      // An outline's first line doesn't take its first item.
      if (dir > 0 && !itemAt(state.tree, text, at) && inOutline(state, at, schema)) return null;
      const across = units[dir < 0 ? i - 1 : i + 1];
      if (across && (across.kind === "edge" || across.kind === "atom")) {
        const found = componentAt(state, dir < 0 ? across.from : across.to - 1, schema);
        // The one on the other side, not the one both are in.
        const component = found && (dir < 0 ? found.to === across.to : found.from === across.from) ? found : null;
        if (u.kind === "break") {
          if (component) return selectOnly({ anchor: component.from, head: component.to, node: true });
          if (across.kind === "atom") return selectOnly({ anchor: across.from, head: across.to, node: true });
        } else if (component && !schema.inline.has(component.name) && ownLines(text, component.from, component.to))
          return selectOnly({ anchor: component.from, head: component.to, node: true });
        // The edge of the content the caret is in (`[` and a newline before its text): nothing to join.
        if (
          across.kind === "edge" &&
          !component &&
          text[dir < 0 ? across.to - 1 : across.from] === (dir < 0 ? "[" : "]")
        )
          return null;
      }
    }
    if (u.kind === "atom") return selectOnly({ anchor: u.from, head: u.to, node: true });
    if (u.kind === "break" || u.kind === "space") {
      const joined = joinItem(state, at, dir, u);
      if (joined) return joined;
    }
    const [from, to] = u.kind === "break" ? [Math.min(at, u.from), Math.max(at, u.to)] : [u.from, u.to];
    const edits = keepCells(state, deleteEdits(state, from, to, schema), schema);
    // The paragraph before ended with a space (Typst's break holds it): joined, the space stays.
    let kept = 0;
    if (u.kind === "break" && /^[ \t]/.test(state.text.slice(u.from, u.to))) {
      const first = edits.find((e) => e.from <= u.from && u.from < e.to);
      if (first) {
        first.insert = ` ${first.insert}`;
        kept = dir < 0 ? 1 : 0;
      }
    }
    return { edits, selection: caret(mapThrough(dir < 0 ? from : at, edits, -1) + kept) };
  };

/** Whether `[from, to)` is all that its lines hold. */
const ownLines = (text: string, from: number, to: number): boolean => {
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const end = text.indexOf("\n", to);
  return text.slice(start, from).trim() === "" && text.slice(to, end < 0 ? undefined : end).trim() === "";
};

/** Whether the `\` at `i` is a line break (Typst's `\` before white space), not an escape. */
const isLineBreak = (state: EditorState, i: number): boolean =>
  state.text[i] === "\\" && pathAt(state.tree, i, 1).at(-1)?.kind === "Linebreak";

/**
 * Where the line break written at `slash` ends: after the spaces that follow its `\`, and after
 * the newline there when the paragraph goes on with the next line.
 */
const lineBreakEnd = (text: string, slash: number): number => {
  let end = slash + 1;
  while (text[end] === " " || text[end] === "\t") end++;
  if (text[end] !== "\n") return end;
  const eol = text.indexOf("\n", end + 1);
  const next = text.slice(end + 1, eol < 0 ? undefined : eol);
  if (next.trim() === "" || next.trim().startsWith("]") || BLOCK_START.test(next)) return end;
  return end + 1 + (next.length - next.trimStart().length);
};

/**
 * Backspace after a line break (Shift+Enter's `\ `) or Delete before one: the break goes whole,
 * its `\` with the spaces that end it. Half of one would escape the character after it (`\*`), or
 * stay in the text as a backslash.
 */
const deleteLineBreak = (state: EditorState, at: number, dir: 1 | -1, schema: EditorSchema): Transaction | null => {
  const text = state.text;
  let slash = at;
  if (dir < 0) {
    while (slash > 0 && /\s/.test(text[slash - 1] as string)) slash--;
    slash--;
  }
  if (slash < 0 || !isLineBreak(state, slash)) return null;
  const end = lineBreakEnd(text, slash);
  // A paragraph's end between the caret and the break goes first.
  if (at > end) return null;
  const edit = { from: slash, to: end, insert: "" };
  const edits = [edit, ...guardDelimiters(state, [edit])].sort((a, b) => a.from - b.from || a.to - b.to);
  const head = mapThrough(slash, edits, -1);
  // On the line it leaves, where a caret stands there (before an empty line's `~`).
  const next = state.apply({ edits, selection: caret(head) }).state;
  return { edits, selection: caret(caretPlace(next, head, schema)) };
};

/**
 * Cells and options that deleting leaves empty get an empty line's `~`: Typst lays out an empty
 * cell as nothing (a row of them has no height, an option no line to click). `typing` is where
 * text is about to go: that one stays as it is.
 */
const keepCells = (state: EditorState, edits: TextEdit[], schema: EditorSchema, typing = -1): TextEdit[] => {
  if (edits.length === 0) return edits;
  const text = state.text;
  const lo = Math.min(...edits.map((e) => e.from));
  const hi = Math.max(...edits.map((e) => e.to));
  const cell = (b: SyntaxNode) => {
    const [from, to] = [b.from + 1, b.to - 1];
    if (from <= typing && typing <= to) return;
    const inside = edits.filter((e) => from <= e.from && e.to <= to);
    // Its brackets go too, or nothing in it does: not an emptied cell.
    if (
      inside.length === 0 ||
      edits.some((e) => e.from < from && e.to > b.from) ||
      edits.some((e) => e.to > to && e.from < b.to)
    )
      return;
    let left = "";
    let at = from;
    for (const e of [...inside].sort((x, y) => x.from - y.from)) {
      left += text.slice(at, e.from) + e.insert;
      at = Math.max(at, e.to);
    }
    left += text.slice(at, to);
    if (left.trim() !== "") return;
    const last = inside.reduce((x, y) => (y.to >= x.to ? y : x));
    last.insert += EMPTY_LINE;
  };
  const visit = (node: SyntaxNode) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      if (c.to < lo || c.from > hi) continue;
      if (c.kind === "FuncCall" && kids[i - 1]?.kind === "Hash" && !schema.marks.has(calleeName(c, text) ?? "")) {
        const blocks = contentBlocksIn(c);
        if (blocks.length > 1) for (const b of blocks) if (b.to > lo && b.from < hi) cell(b);
      }
      if (c.children.length) visit(c);
    }
  };
  visit(state.tree);
  return edits;
};

/**
 * Backspace or Delete at or beside an empty line: the line goes (with the break that set it apart),
 * as an empty paragraph does in a word processor; in a table cell nothing happens, the cell stays.
 * `undefined` when no empty line is involved.
 */
const removeEmptyLine = (state: EditorState, at: number, dir: 1 | -1): Transaction | null | undefined => {
  const text = state.text;
  // The empty line the caret is on, or the one across the break the key would join.
  let i = emptyLineAt(text, at);
  if (i < 0) {
    let j = at;
    if (dir < 0) {
      while (j > 0 && /\s/.test(text[j - 1] as string)) j--;
      if (j < at && text.slice(j, at).includes("\n\n") && isEmptyLine(text, j - 1)) i = j - 1;
    } else {
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      if (j > at && text.slice(at, j).includes("\n\n") && isEmptyLine(text, j)) i = j;
    }
    if (i < 0) return undefined;
  }
  // Alone in a content block (a cell): it stays.
  let a = i;
  while (a > 0 && /[ \t]/.test(text[a - 1] as string)) a--;
  if (text[a - 1] === "[") return selectOnly(caret(i));
  // The line and the blank line before it, back to the text before; at the start, the one after.
  let from = a;
  while (from > 0 && /\s/.test(text[from - 1] as string)) from--;
  let to = i + 1;
  if (from === 0 || text[from - 1] === "[") {
    from = a;
    while (to < text.length && /\s/.test(text[to] as string)) to++;
    if (text[to] === "]") to = i + 1;
  }
  // Onto an empty line above: before its `~`.
  return { edits: [{ from, to, insert: "" }], selection: caret(isEmptyLine(text, from - 1) ? from - 1 : from) };
};

/**
 * Backspace at the start of an aligned block's text takes the alignment off, as it takes a
 * heading's marker: an emptied centred line can go, and the text is at the margin again.
 */
const unalign = (state: EditorState, at: number): Transaction | null => {
  const text = state.text;
  const path = pathAt(state.tree, at, -1);
  for (let i = path.length - 1; i >= 3; i--) {
    const block = path[i] as SyntaxNode;
    const call = path[i - 2] as SyntaxNode;
    if (block.kind !== "ContentBlock" || call.kind !== "FuncCall" || calleeName(call, text) !== "align") continue;
    if (at <= block.from || text.slice(block.from + 1, at).trim() !== "") return null;
    const hash = (path[i - 3] as SyntaxNode).children.find((k) => k.kind === "Hash" && k.to === call.from);
    if (!hash) return null;
    // The white space inside its brackets goes with them.
    let start = block.from + 1;
    while (start < block.to - 1 && /\s/.test(text[start] as string)) start++;
    let end = block.to - 1;
    while (end > start && /\s/.test(text[end - 1] as string)) end--;
    const edits = [
      { from: hash.from, to: start, insert: "" },
      { from: end, to: call.to, insert: "" },
    ];
    return { edits, selection: caret(hash.from) };
  }
  return null;
};

/**
 * Joining across the break before a list item or heading (Delete at a paragraph's end), or into an
 * empty item above (Backspace): the item's marker goes with the break, so it doesn't show as text
 * (`Things you need:- a pencil`); an empty item above goes whole.
 */
const joinItem = (state: EditorState, at: number, dir: 1 | -1, u: Unit): Transaction | null => {
  const text = state.text;
  if (!/\n/.test(text.slice(Math.min(at, u.from), Math.max(at, u.to)))) return null;
  if (dir > 0) {
    // The line after: a marker to take with the break.
    const next = Math.max(at, u.to);
    const marker = /^[ \t]*(?:[-+/]|\d+\.|=+)[ \t]+/.exec(text.slice(next));
    if (!marker) return null;
    return { edits: [{ from: at, to: next + marker[0].length, insert: "" }], selection: caret(at) };
  }
  // The line before: an empty item.
  const start = Math.min(at, u.from);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  if (!/^[ \t]*(?:[-+/]|\d+\.)[ \t]*$/.test(text.slice(lineStart, start))) return null;
  const edits = [{ from: lineStart, to: text.lastIndexOf("\n", at - 1) + 1, insert: "" }];
  return { edits, selection: caret(mapThrough(at, edits, 1)) };
};

/**
 * Backspace at the start of an outline's top-level item (a mind map's branch): it joins the item on
 * the line before, so an empty one goes. The first stays an item: the line before it is the
 * outline's own (a map's topic), and a paragraph there would be no branch.
 */
const joinBranch = (state: EditorState, item: SyntaxNode, at: number): Transaction => {
  const text = state.text;
  const lineStart = text.lastIndexOf("\n", item.from - 1) + 1;
  const above = lineStart > 0 ? text.slice(text.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1) : "";
  if (!/^[ \t]*(?:[-+]|\d+\.)(?:[ \t]|$)/.test(above)) return selectOnly(caret(at));
  return { edits: [{ from: lineStart - 1, to: textStart(text, item), insert: "" }], selection: caret(lineStart - 1) };
};

/** Edits that turn a heading or list item into a paragraph: its marker goes, and it stays a block of its own. */
const unmark = (state: EditorState, item: SyntaxNode): TextEdit[] => {
  const body = item.children.find((k) => k.kind === "Markup");
  const text = state.text;
  // An empty one (`= `): the space after its marker goes too, or the paragraph would start with it.
  let end = body?.from ?? item.to;
  if (!body || body.from === body.to) while (text[end] === " " || text[end] === "\t") end++;
  const edits: TextEdit[] = [{ from: item.from, to: end, insert: "" }];
  const lineStart = text.lastIndexOf("\n", item.from - 1);
  // The text before on the previous line would run into it: a blank line keeps them apart.
  if (lineStart > 0 && text[lineStart - 1] !== "\n" && text.slice(lineStart + 1, item.from).trim() === "")
    edits.unshift({ from: lineStart, to: lineStart, insert: "\n" });
  // And from what follows: an item right after a paragraph is attached to it (no gap between).
  const after = text.indexOf("\n", item.to);
  const next =
    after < 0
      ? ""
      : text.slice(after + 1, text.indexOf("\n", after + 1) < 0 ? undefined : text.indexOf("\n", after + 1));
  if (after >= 0 && next.trim() !== "" && !next.trim().startsWith("]"))
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
    if (state.empty) {
      const placed = caretPlace(state, state.selection.head, schema);
      if (placed !== state.selection.head) state = state.select(caret(placed));
    }
    // Typed into an empty line: the text replaces its `~`.
    const empty = state.empty ? emptyLineAt(state.text, state.selection.head) : -1;
    // Spaces at a line's start show nothing in Typst: on an empty line they change nothing.
    if (empty >= 0 && typed.trim() === "") return selectOnly(caret(empty));
    if (empty >= 0) state = state.select({ anchor: empty, head: empty + 1 });
    const from = state.from;
    const to = state.to;
    const deletions = from < to ? deleteEdits(state, from, to, schema, true) : [];
    // A construct that goes whole though the selection starts inside it (an equation): the text
    // goes where it was.
    const whole = deletions.find((d) => d.from < from && from < d.to);
    const at = whole ? whole.from : from;
    // Where the text goes: the selection's start, after what is deleted there.
    const ctx = contextAt(state.tree, at, whole ? -1 : 1);
    if (ctx === null) return null;
    keepCells(state, deletions, schema, at);
    const text = state.text;
    let insert = typed;
    /** A `-` or `+` starting a list item's text, a space typed after it: escaped, or it nests a list. */
    let marker = -1;
    if (ctx === "markup") {
      const lineStart = text.lastIndexOf("\n", from - 1) + 1;
      const before = text.slice(lineStart, from);
      const afterEnd = deletions.length ? (deletions[deletions.length - 1] as TextEdit).to : to;
      const after = text.slice(afterEnd, afterEnd + 4);
      // A list item's text starts a line as Typst reads it: a marker typed there (`2. `, `- `) would
      // nest a list in the item, so it is escaped like one at a line's start, and the dot after a
      // number that starts the item too.
      const own = ITEM_MARKERS.exec(before);
      const rest = own ? before.slice(own[0].length) : null;
      const plain = typed.replace(/\r\n?/g, "\n");
      if (rest !== null && /^\p{N}+$/u.test(rest) && plain.startsWith("."))
        insert = `\\.${escapeMarkup(plain.slice(1), `${before}.`, after)}`;
      else insert = escapeMarkup(plain, rest === "" ? "" : before, after);
      if (rest !== null && /^[-+]$/.test(rest) && /^[ \t]/.test(plain)) marker = from - 1;
      if (typed === " " && (/\s$/.test(before) || atLineStart(before) || before.endsWith("~"))) insert = "~";
    } else if (ctx === "raw") {
      insert = typed.replace(/`/g, "ˋ");
    }
    // Right after (or before) a component or equation set on its own line, text would join its
    // code (`#number-line(…)After`): a paragraph of its own instead.
    let apart = 0;
    if (ctx === "markup" && from === to) {
      const units = unitsFor(state, schema);
      const lineStart = text.lastIndexOf("\n", from - 1) + 1;
      const eol = text.indexOf("\n", from);
      const lineEnd = eol < 0 ? text.length : eol;
      const before = units[unitBefore(units, from)];
      const after = units[unitAfter(units, from)];
      // The piece that ends (`side` -1) or starts at the caret: a unit shown whole, or the component
      // whose last or first delimiter is there (a question's `]`).
      const piece = (u: Unit | undefined, side: 1 | -1): { from: number; to: number } | null => {
        if (u?.kind === "atom") return (side < 0 ? u.to : u.from) === from ? u : null;
        if (u?.kind !== "edge") return null;
        return componentsAt(state, from, schema).find((c) => (side < 0 ? c.to : c.from) === from) ?? null;
      };
      // A piece set as a block: a component, an equation on display (`$ x $`). An inline equation or
      // call alone on its line is a paragraph's first piece, and text typed beside it joins it.
      const block = (r: { from: number; to: number } | null): boolean => {
        if (!r || !ownLines(text, r.from, r.to)) return false;
        const source = text.slice(r.from, r.to);
        if (source.startsWith("$")) return /^\$\s/.test(source) && /\s\$$/.test(source);
        const name = /^#([\p{L}_][\p{L}\p{N}_.-]*)[([]/u.exec(source)?.[1];
        return source.startsWith("#") && !(name !== undefined && schema.inline.has(name));
      };
      if (text.slice(from, lineEnd).trim() === "" && block(piece(before, -1))) insert = `\n\n${insert}`;
      else if (text.slice(lineStart, from).trim() === "" && block(piece(after, 1))) {
        insert = `${insert}\n\n`;
        apart = 2;
      }
    }
    const edits: TextEdit[] = [...deletions];
    if (marker >= 0) edits.push({ from: marker, to: marker, insert: "\\" });
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
      ) +
      insert.length -
      apart;
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

/** A line's source up to a list item's text: its marker, and those of items nested on the same line. */
const ITEM_MARKERS = /^[ \t]*(?:(?:[-+]|\p{N}+\.)[ \t]+)+/u;

/**
 * Text typed or deleted next to a `*` or `_` delimiter can turn it into text: Typst reads one
 * between two letters as text (lexer.rs `in_word`). Strong or emph text whose delimiter would end
 * up so becomes `#strong[…]` / `#emph[…]`, which reads the same anywhere.
 */
export const guardDelimiters = (state: EditorState, edits: readonly TextEdit[]): TextEdit[] => {
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
  // A component selected: a new paragraph after it, not in its place.
  if (state.selection.node) base = state.select(caret(state.to));
  else if (!state.empty) {
    const del = deleteSelection(state, schema);
    if (!del) return null;
    const applied = state.apply(del);
    base = applied.state;
    if (applied.edit) pre.push(applied.edit);
  }
  // In styled text the style ends before the break and starts again after it.
  const styled = splitMarks(base, schema);
  if (styled) base = styled;
  const at = base.selection.head;
  // Between a style's two halves is markup, though code is on both sides (`#text(…)[a]‸#text(…)[b]`).
  if (!styled && !canType(base, at)) return null;
  const text = base.text;
  const path = pathAt(base.tree, at, -1);
  const found = itemAt(base.tree, text, at);
  const item = found && found.kind !== "Heading" ? found : null;
  const outline = inOutline(base, at, schema);
  let tr: Transaction;
  if (item && item.from < at) {
    const marker = item.children[0] as SyntaxNode;
    const body = item.children.find((k) => k.kind === "Markup");
    if (isEmptyItem(text, item)) {
      // An empty item goes up a level, and from the top level ends the list (an outline is its
      // list: there it stays).
      tr = outdentItem(base, item, at) ?? (outline ? selectOnly(caret(at)) : leaveList(text, item));
    } else if (body && at <= body.from) {
      // At the start of the item's text: an empty item before it.
      const indent = " ".repeat(column(text, item.from));
      const markerText = item.kind === "EnumItem" ? "+" : text.slice(marker.from, marker.to);
      const insert = `${markerText} \n${indent}`;
      // The caret stays with the text, in the item pushed down.
      tr = { edits: [{ from: item.from, to: item.from, insert }], selection: caret(at + insert.length) };
    } else {
      const indent = " ".repeat(column(text, item.from));
      const markerText =
        item.kind === "EnumItem" ? "+" : item.kind === "TermItem" ? "/" : text.slice(marker.from, marker.to);
      const insert = item.kind === "TermItem" ? `\n${indent}/ ` : `\n${indent}${markerText} `;
      // The rest of the line's spaces stay with the text after the break, not before.
      tr = { edits: [{ from: at, to: at, insert }], selection: caret(at + insert.length) };
    }
  } else if (outline && !found) {
    // An outline's first line (a mind map's topic): Enter starts its first item, with the text
    // after the caret.
    let b = at;
    while (b < text.length && (text[b] === " " || text[b] === "\t")) b++;
    const insert = `\n${" ".repeat(Math.max(0, indentOf(text, at)))}- `;
    const typed = text.slice(text.lastIndexOf("\n", at - 1) + 1, at).trim() !== "";
    tr = typed ? { edits: [{ from: at, to: b, insert }], selection: caret(at + insert.length) } : selectOnly(caret(at));
  } else {
    const isHeading = (n: SyntaxNode) => n.kind === "Heading";
    const heading = findLast(path, isHeading) ?? findLast(pathAt(base.tree, at, 1), isHeading);
    const body = heading?.children.find((k) => k.kind === "Markup");
    if (heading && body && at <= body.from) {
      // An empty line before the heading.
      const insert = `${EMPTY_LINE}\n\n`;
      tr = { edits: [{ from: heading.from, to: heading.from, insert }], selection: caret(at + insert.length) };
    } else if (heading && body && at < body.to && text.slice(at, body.to).trim() !== "") {
      // In the middle of a heading: two headings, as word processors keep a split line's style.
      let b = at;
      while (b < body.to && (text[b] === " " || text[b] === "\t")) b++;
      const marker = heading.children[0] as SyntaxNode;
      const insert = `\n\n${" ".repeat(column(text, heading.from))}${text.slice(marker.from, marker.to)} `;
      tr = { edits: [{ from: at, to: b, insert }], selection: caret(at + insert.length) };
    } else {
      // Spaces after the break would start the new paragraph: they go. Those before it stay, so
      // joining the paragraphs again (Backspace) gives the text back as it was.
      const a = at;
      let b = at;
      while (b < text.length && (text[b] === " " || text[b] === "\t")) b++;
      // At a line's end in a paragraph that goes on with the next line: that line starts the new
      // paragraph (a component on a line of its own stays there, an empty line above it).
      if (
        text[b] === "\n" &&
        text.slice(text.lastIndexOf("\n", a - 1) + 1, a).trim() !== "" &&
        continues(base, b, schema)
      ) {
        b++;
        while (b < text.length && (text[b] === " " || text[b] === "\t")) b++;
      }
      const indent = " ".repeat(Math.max(0, indentOf(text, at)));
      const insert = `\n\n${indent}`;
      // A paragraph left with no text (Enter at a paragraph's end or start, or on an empty line)
      // is an empty line, written so the pages show it.
      const next = text.slice(0, a) + insert + text.slice(b);
      const emptyBefore = inEmptyParagraph(next, a);
      const emptyAfter = inEmptyParagraph(next, a + insert.length);
      const written = (emptyBefore ? EMPTY_LINE : "") + insert + (emptyAfter ? EMPTY_LINE : "");
      const caretAt = a + written.length - (emptyAfter ? EMPTY_LINE.length : 0);
      tr = { edits: [{ from: a, to: b, insert: written }], selection: caret(caretAt) };
    }
  }
  if (pre.length === 0 && !styled) return tr;
  return chain(state, base, tr);
};

/**
 * Enter in styled text (`*bo‸ld*`, a colour): Typst's marks don't cross a paragraph break (an
 * unclosed delimiter), so each mark around the caret is closed before it and opened again after
 * it. At a mark's edge the caret goes outside it instead. `null` where no mark is around it.
 */
const splitMarks = (state: EditorState, schema: EditorSchema): EditorState | null => {
  const text = state.text;
  const head = state.selection.head;
  let at = head;
  const marks: { from: number; to: number; innerFrom: number; innerTo: number }[] = [];
  const visit = (node: SyntaxNode) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      if (c.to < at || c.from > at) continue;
      let from = c.from;
      let inner: SyntaxNode | undefined;
      if (c.kind === "Strong" || c.kind === "Emph") inner = c.children.find((k) => k.kind === "Markup");
      else if (c.kind === "FuncCall" && kids[i - 1]?.kind === "Hash") {
        const name = calleeName(c, text);
        const blocks = contentBlocksIn(c);
        if (name !== null && schema.marks.has(name) && blocks.length === 1 && (blocks[0] as SyntaxNode).to === c.to) {
          inner = (blocks[0] as SyntaxNode).children.find((k) => k.kind === "Markup");
          from = (kids[i - 1] as SyntaxNode).from;
        }
      }
      if (inner && inner.from <= at && at <= inner.to)
        marks.push({ from, to: c.to, innerFrom: inner.from, innerTo: inner.to });
      visit(c);
    }
  };
  visit(state.tree);
  if (marks.length === 0) return null;
  for (let m = marks.at(-1); m; m = marks.at(-1)) {
    if (at === m.innerTo) at = m.to;
    else if (at === m.innerFrom) at = m.from;
    else break;
    marks.pop();
  }
  const close = [...marks].reverse().map((m) => text.slice(m.innerTo, m.to));
  const open = marks.map((m) => text.slice(m.from, m.innerFrom));
  const insert = close.join("") + open.join("");
  if (insert === "" && at === head) return null;
  return state.apply({ edits: [{ from: at, to: at, insert }], selection: caret(at + close.join("").length) }).state;
};

/** Whether the line after the newline at `eol` goes on with the paragraph before it (text, an inline call). */
const continues = (state: EditorState, eol: number, schema: EditorSchema): boolean => {
  const text = state.text;
  const end = text.indexOf("\n", eol + 1);
  const line = text.slice(eol + 1, end < 0 ? undefined : end);
  if (line.trim() === "" || line.trim().startsWith("]") || BLOCK_START.test(line)) return false;
  const start = eol + 1 + (line.length - line.trimStart().length);
  const component = text[start] === "#" ? componentsAt(state, start, schema).find((c) => c.from === start) : null;
  return !(component && !schema.inline.has(component.name) && ownLines(text, component.from, component.to));
};

const LIST_ITEMS = new Set(["ListItem", "EnumItem", "TermItem"]);

/** Whether a list item (or heading) has no text. */
const isEmptyItem = (text: string, item: SyntaxNode): boolean => {
  const body = item.children.find((k) => k.kind === "Markup");
  return !body || text.slice(body.from, body.to).trim() === "";
};

/** Whether `at` is on a line of its own between blank lines (or a content block's edges): an empty paragraph. */
const inEmptyParagraph = (text: string, at: number): boolean => {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const next = text.indexOf("\n", at);
  const lineEnd = next < 0 ? text.length : next;
  // The line's rest may close the content block it is in (`‸]`): the paragraph ends there.
  const closes = /^[ \t]*\]/.test(text.slice(at, lineEnd));
  if (text.slice(lineStart, at).trim() !== "" || (!closes && text.slice(at, lineEnd).trim() !== "")) return false;
  const above = text.slice(0, Math.max(0, lineStart - 1));
  const below = next < 0 ? "" : text.slice(next + 1);
  const blankAbove = lineStart === 0 || /(^|\n)[ \t]*$/.test(above) || /\[[ \t]*$/.test(above);
  const blankBelow =
    closes || next < 0 || /^[ \t]*(\n|$|\])/.test(below) || BLOCK_START.test(below) || CALL_START.test(below);
  return blankAbove && blankBelow;
};

/**
 * Whether the `~` at `i` is a block of its own (see {@link EMPTY_LINE}): alone on a line between
 * blank lines or a content block's edges, or alone in a content block (`[~]`, a table cell).
 * @beta
 */
export const isEmptyLine = (text: string, i: number): boolean => {
  if (text[i] !== "~" || text[i - 1] === "\\") return false;
  let a = i;
  while (a > 0 && (text[a - 1] === " " || text[a - 1] === "\t")) a--;
  let b = i + 1;
  while (b < text.length && (text[b] === " " || text[b] === "\t")) b++;
  const left = a === 0 ? "\n" : (text[a - 1] as string);
  const right = b >= text.length ? "\n" : (text[b] as string);
  if (left === "[" && right === "]") return true;
  if ((left !== "\n" && left !== "[") || (right !== "\n" && right !== "]")) return false;
  // On a line of its own: a paragraph only with blank lines (or the block's edges) around it.
  const above = text.slice(0, Math.max(0, a - 1));
  const below = text.slice(b + 1);
  const blankAbove = left === "[" || a === 0 || /(^|\n)[ \t]*$/.test(above) || /\[[ \t]*$/.test(above);
  const blankBelow =
    right === "]" ||
    b >= text.length ||
    /^[ \t]*(\n|$|\])/.test(below) ||
    BLOCK_START.test(below) ||
    CALL_START.test(below);
  return blankAbove && blankBelow;
};

/** The empty line beside a caret at `at` (its `~` just after or before it), or -1. */
export const emptyLineAt = (text: string, at: number): number =>
  isEmptyLine(text, at) ? at : isEmptyLine(text, at - 1) ? at - 1 : -1;

/**
 * An empty item turned into an empty paragraph after the list (at the item's indentation, in a
 * content block), with blank lines around it so what is typed there is a paragraph of its own.
 */
const leaveList = (text: string, item: SyntaxNode): Transaction => {
  const lineStart = text.lastIndexOf("\n", item.from - 1) + 1;
  let end = item.to;
  while (text[end] === " " || text[end] === "\t") end++;
  const indent = " ".repeat(column(text, item.from));
  const insert = `\n${indent}`;
  // A line of text right after the item would run into the new paragraph: a blank line between.
  const next = /^\n[ \t]*(.*)/.exec(text.slice(end))?.[1] ?? "";
  const joins = next !== "" && !next.startsWith("]") && !/^(?:[-+/=]|\d+\.)(?:\s|$)/.test(next);
  const after = joins ? "\n" : "";
  return {
    edits: [{ from: lineStart, to: end, insert: insert + EMPTY_LINE + after }],
    selection: caret(lineStart + insert.length),
  };
};

/**
 * A nested list item moved up a level: it and the lines under it (its text, its own items) lose
 * the indentation it has beyond the item it is nested in. `null` for an item at the top level.
 */
const outdentItem = (state: EditorState, item: SyntaxNode, at: number): Transaction | null => {
  if (!LIST_ITEMS.has(item.kind)) return null;
  const text = state.text;
  const parent = findLast(
    pathAt(state.tree, item.from, 1),
    (n) => LIST_ITEMS.has(n.kind) && n.from < item.from && item.to <= n.to,
  );
  if (!parent) return null;
  const delta = column(text, item.from) - column(text, parent.from);
  if (delta <= 0) return null;
  const edits: TextEdit[] = [];
  for (let line = text.lastIndexOf("\n", item.from - 1) + 1; line <= item.to; ) {
    // A tab is one column, as `column` and Typst's nesting count it.
    let n = 0;
    while (n < delta && (text[line + n] === " " || text[line + n] === "\t")) n++;
    if (n) edits.push({ from: line, to: line + n, insert: "" });
    const next = text.indexOf("\n", line);
    if (next < 0) break;
    line = next + 1;
  }
  return { edits, selection: caret(mapThrough(at, edits, 1)) };
};

/**
 * Ctrl+Enter (and Ctrl+Shift+Enter, `dir` -1): an empty paragraph after (before) the top-level
 * block the caret is in, so the teacher can write after a component, a table or a list (a list
 * whole, its items together) without leaving them by hand. Plate's "exit break".
 * @beta
 */
export const exitBlock =
  (dir: 1 | -1) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const at = state.selection.head;
    const blocks = blocksOf(state.tree, state.text, (name) => schema.inline.has(name));
    let i = blocks.findIndex((b) => b.from <= at && at <= b.to);
    for (let k = blocks.length - 1; i < 0 && k >= 0; k--) if ((blocks[k] as Block).to <= at) i = k;
    if (i < 0) return null;
    const isList = (b: Block | undefined) => b?.kind === "list" || b?.kind === "enum" || b?.kind === "term";
    let [first, last] = [i, i];
    if (isList(blocks[i])) {
      const kind = (blocks[i] as Block).kind;
      while (blocks[first - 1]?.kind === kind) first--;
      while (blocks[last + 1]?.kind === kind) last++;
    }
    if (dir > 0) {
      const end = (blocks[last] as Block).to;
      return { edits: [{ from: end, to: end, insert: `\n\n${EMPTY_LINE}` }], selection: caret(end + 2) };
    }
    const start = (blocks[first] as Block).from;
    return { edits: [{ from: start, to: start, insert: `${EMPTY_LINE}\n\n` }], selection: caret(start) };
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
  let at = s.selection.head;
  if (!canType(s, at)) return null;
  const text = s.text;
  // An empty line stays the line above (its `~` keeps its height); spaces at the caret end that
  // line, where they show nothing. Nothing else is written, so Backspace gives the text back.
  const empty = emptyLineAt(text, at);
  if (empty >= 0) at = empty + 1;
  else while (text[at] === " " || text[at] === "\t") at++;
  const insert = "\\ ";
  const tr: Transaction = { edits: [{ from: at, to: at, insert }], selection: caret(at + insert.length) };
  return base ? chain(state, s, tr) : tr;
};

/**
 * One transaction from `state` to `mid` (edits already made) and on through `tr`: what was
 * replaced in `state` by everything, as a single edit.
 */
export const chain = (state: EditorState, mid: EditorState, tr: Transaction): Transaction => {
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
// Where a caret has nothing to stand by

/** A line that starts a block of its own: a list item, a heading, a term. */
const BLOCK_START = /^[ \t]*(?:[-+/=]|\d+\.)(?:[ \t]|$)/;

/**
 * A line that starts with a call: a component's, where an empty line right above it is a line of
 * its own (Enter at the end of a question's text, above its options).
 */
const CALL_START = /^[ \t]*#[\p{L}_][\p{L}\p{N}_.-]*[([]/u;

/** Whether the line `at` is on ends at `at`'s block: nothing after it, and a blank line, a block or the end next. */
const endsBlock = (text: string, at: number): boolean => {
  const eol = text.indexOf("\n", at);
  if (eol < 0) return text.slice(at).trim() === "";
  if (text.slice(at, eol).trim() !== "") return false;
  const next = text.slice(eol + 1, text.indexOf("\n", eol + 1) < 0 ? undefined : text.indexOf("\n", eol + 1));
  return next.trim() === "" || next.trim().startsWith("]") || BLOCK_START.test(next);
};

/** A unit Typst draws glyphs for: text, a quote, an equation (not a line break, which draws nothing). */
const drawn = (text: string, u: Unit | undefined): u is Unit =>
  !!u && (u.kind === "atom" || (u.kind === "char" && !/^\\\+?$/.test(text.slice(u.from, u.to))));

/**
 * Where a caret has no glyph beside it, so the view can't draw it from the layout: Typst lays out
 * nothing there. After a space ending a paragraph (Typst drops it), in an empty paragraph, list
 * item, heading or table cell, after a line break ending a paragraph. The view compiles its text
 * with a placeholder at that offset (a non-breaking space: a glyph, and the line's height) while
 * the caret is there, so the caret stands where the next character will. `null` where a glyph is
 * beside the caret, or it isn't in markup.
 * @beta
 */
export const caretAnchor = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): number | null => {
  if (!state.empty || state.selection.node) return null;
  const at = state.selection.head;
  if (contextAt(state.tree, at) !== "markup") return null;
  const units = unitsFor(state, schema);
  const inside = unitInside(units, at);
  const text = state.text;
  // Between the newlines of a blank line: an empty paragraph. In a space running onto the next
  // line: only where the paragraph ends with the line (a list item's last space), else the space
  // is laid out between the words.
  if (inside) return inside.kind === "break" || (inside.kind === "space" && endsBlock(text, at)) ? at : null;
  const tight = (from: number, to: number) => !/\s/.test(text.slice(from, to));
  const before = units[unitBefore(units, at)];
  if (drawn(text, before) && tight(before.to, at)) return null;
  const i = unitAfter(units, at);
  const after = units[i];
  if (drawn(text, after) && tight(at, after.from)) return null;
  // Spaces before text in the same paragraph (a content block's leading newline): Typst lays out the text.
  const then = units[i + 1];
  if (after?.kind === "space" && after.from === at && drawn(text, then) && then.from === after.to) return null;
  // Before what starts on the caret's line (a heading's or an item's marker, a component's call):
  // a glyph in front would make the marker text, or the call part of a paragraph. Only what closes
  // the caret's own content (`]`, a mark's delimiter) or a line break may follow it.
  const eol = text.indexOf("\n", at);
  const rest = text.slice(at, eol < 0 ? undefined : eol).trim();
  if (rest !== "" && !/^(?:[\]*_]|\\(?:\s|$))/.test(rest)) return null;
  return at;
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
): number => {
  const units = unitsFor(state, schema);
  let to = step(units, offset, dir);
  // An empty line is one place for the caret, before its `~`: right from there goes past it.
  if (dir > 0 && to === offset + 1 && isEmptyLine(state.text, offset)) to = step(units, to, dir);
  // Offsets that are one place on the page are one stop: on, until the place is another.
  for (let hops = 0; hops < 4; hops++) {
    const placed = caretPlace(state, to, schema);
    if (placed !== offset && !beforeBlock(state, placed, schema)) return (placed - offset) * dir > 0 ? placed : offset;
    const next = step(units, to, dir);
    if (next === to) break;
    to = next;
  }
  return offset;
};

/**
 * Whether `at` is before a component on lines of its own, a blank line above it and a block the
 * caret can end: the arrow keys stop once between the two, at that block's end (text typed at
 * either is a paragraph between them).
 */
const beforeBlock = (state: EditorState, at: number, schema: EditorSchema): boolean => {
  const text = state.text;
  if (text[at] !== "#") return false;
  let end = at;
  while (end > 0 && /\s/.test(text[end - 1] as string)) end--;
  if (end === 0 || text[end - 1] === "[" || !/\n[ \t]*\n/.test(text.slice(end, at))) return false;
  const component = componentsAt(state, at, schema).find((c) => c.from === at);
  if (!component || schema.inline.has(component.name) || !ownLines(text, component.from, component.to)) return false;
  // Not after the rules a document starts with: no caret stands there.
  return caretPlace(state, end, schema) === end;
};

/** Where a heading's or an item's text starts: after its marker and the spaces after it. */
const textStart = (text: string, item: SyntaxNode): number => {
  const inner = item.children.find((k) => k.kind === "Markup");
  if (inner && inner.to > inner.from) return inner.from;
  let end = (item.children[0] as SyntaxNode).to;
  while (text[end] === " " || text[end] === "\t") end++;
  return end;
};

/**
 * The document's own text: from after the rules it starts with (`#import`, `#set`, its template)
 * to its last character. What Ctrl+A selects, and where Ctrl+Home and Ctrl+End go.
 * @internal
 */
export const bodyRange = (state: EditorState): { from: number; to: number } => {
  const text = state.text;
  const body = bodyStart(state.tree);
  const rest = text.slice(body);
  if (rest.trim() === "") return { from: body, to: body };
  return { from: body + rest.length - rest.trimStart().length, to: body + rest.trimEnd().length };
};

/**
 * The place a caret takes at `offset`, where several offsets are one place on the page and text
 * typed at the others would come out wrong. Before a heading's or a list item's marker it is after
 * the marker (typed before it, text makes the heading a paragraph showing its `=`); after the
 * newline that ends a content block's or the document's text it is before it, and before the one
 * that starts a block's after it (the newline would be a space beside what is typed); among the
 * rules a document starts with (`#import`, `#set`, its template) it is where its text starts.
 * @beta
 */
export const caretPlace = (state: EditorState, offset: number, schema: EditorSchema = DEFAULT_SCHEMA): number => {
  const text = state.text;
  const units = unitsFor(state, schema);
  let at = offset;
  const inContent = (side: 1 | -1) =>
    pathAt(state.tree, at, side).some((n) => n.kind === "ContentBlock" && n.from < at && at < n.to);
  // Beside a rule, not in its text (a template's title): where the text after the rules starts.
  const start = bodyRange(state).from;
  if (at < start && !inContent(1) && !inContent(-1)) at = start;
  // One line break, which Typst reads as a space (two are an empty paragraph, a place of its own).
  const newline = (u: Unit | undefined): u is Unit =>
    !!u && (u.kind === "space" || u.kind === "break") && text.slice(u.from, u.to).split("\n").length === 2;
  const before = units[unitBefore(units, at)];
  const i = unitAfter(units, at);
  const after = units[i];
  const closes = text[at] === "]" || text.slice(at).trim() === "";
  if (newline(before) && before.to === at && closes)
    at = before.from + text.slice(before.from, before.to).indexOf("\n");
  else if (newline(after) && after.from === at && text[at - 1] === "[" && units[i + 1] && units[i + 1]?.kind !== "edge")
    at = after.to;
  // In the spaces that end a line break (`\ `): after them, where the next line's text goes (typed
  // right after the `\`, a character would be escaped by it).
  let slash = at;
  while (slash > 0 && (text[slash - 1] === " " || text[slash - 1] === "\t")) slash--;
  if (isLineBreak(state, slash - 1)) at = Math.max(at, lineBreakEnd(text, slash - 1));
  // Before a marker on its line: where the block's text starts.
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  if (text.slice(lineStart, at).trim() === "") {
    let p = at;
    while (text[p] === " " || text[p] === "\t") p++;
    const item = pathAt(state.tree, p, 1).find((n) => ITEM_NODES.has(n.kind) && n.from === p);
    if (item) at = textStart(text, item);
  } else {
    // Between a marker and its text (`-‸ one`): the same.
    const item = pathAt(state.tree, at, -1).find((n) => ITEM_NODES.has(n.kind));
    if (item && at < textStart(text, item)) at = textStart(text, item);
  }
  return isEmptyLine(text, at - 1) ? at - 1 : at;
};

/**
 * Snaps `offset` to a place a caret can be: not inside a character, an atom or a component's code.
 * @beta
 */
export const snap = (state: EditorState, offset: number, schema: EditorSchema = DEFAULT_SCHEMA): number => {
  const units = unitsFor(state, schema);
  const inside = unitInside(units, offset);
  const at = inside ? (offset - inside.from < inside.to - offset ? inside.from : inside.to) : offset;
  // On an empty line, before its `~`.
  return isEmptyLine(state.text, at - 1) ? at - 1 : at;
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
