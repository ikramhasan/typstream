// Keys in a component's content arguments: the options of a multiple choice, a rubric's cells, a
// true/false's statement. Tab goes from one to the next as in a table; in a component whose
// positional content arguments are its items (`EditorSchema.lists`: a multiple choice), Enter adds
// one (in an item's text, the text after the caret is the new one's) and Backspace in an empty one
// removes it, the argument that numbers an item (`EditorSchema.indexes`: the correct option)
// following its item; elsewhere, Enter in content written on one line leaves the component (a
// statement doesn't become two paragraphs), or breaks the line in a cell. In a component whose
// positional arguments are rows of cells (`EditorSchema.rows`: a rubric's criteria), Tab past the
// last cell adds a row and Backspace in an empty row removes it.
//
// An argument written as code shows text too (`mcq(ce("H2O"), "Water", $x$)`), but a caret has no
// place in code: a click on one writes it as the content that shows the same (`argAsContent`), or,
// where the pages don't say which argument was clicked (glyphs a package draws have no place in
// the source), all of the component's (`argsAsContent`), which the view keeps only when the pages
// laid out again show the click was on one.

import type { TextEdit } from "@typstream/core";
import { hasErrors, type SyntaxNode } from "@typstream/syntax";
import { canType, DEFAULT_SCHEMA, type EditorSchema, exitBlock, insertLineBreak } from "./commands";
import { type Component, componentsAt } from "./components";
import type { EditorCommand } from "./plugin";
import type { EditorState, Transaction } from "./state";
import { EMPTY_LINE, escapeMarkup, readString } from "./text";
import { callArgs, calleeName, contentBlocksIn, pathAt } from "./tree";

/** The innermost component around the caret with content arguments, and the one holding the caret. */
const argsAt = (state: EditorState, schema: EditorSchema) => {
  const at = state.selection.head;
  // Beside a piece shown whole (a formula ending an option), the caret is at that call's edge too:
  // the content is the one's around it.
  for (const component of componentsAt(state, at, schema)) {
    const blocks = contentBlocksIn(component.call);
    const index = blocks.findIndex((b) => b.from < at && at < b.to);
    if (index >= 0) return { component, blocks, index, block: blocks[index] as SyntaxNode };
    if (blocks.length) break;
  }
  return null;
};

/** Inside a content block's brackets. */
const innerOf = (b: SyntaxNode) => ({ from: b.from + 1, to: b.to - 1 });

/** Whether a content block holds nothing but whitespace or an empty line's `~`. */
const isEmptyBlock = (text: string, b: SyntaxNode) => /^\s*~?\s*$/.test(text.slice(b.from + 1, b.to - 1));

/** Whether the component's positional content arguments are its items. */
const isList = (schema: EditorSchema, c: Component) => schema.lists?.has(c.name) ?? false;

/**
 * Tab (`dir` 1) or Shift+Tab (-1) in a component's content: the next or previous one's text
 * selected; past a list's last item, a new item; past the last cell of a component's last row (a
 * rubric's), a new row. `null` outside one (or in a table: `moveCell`).
 * @beta
 */
export const moveArg =
  (dir: 1 | -1): EditorCommand =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const found = argsAt(state, schema);
    if (!found) return null;
    const row = dir > 0 ? rowAt(state, found, schema) : null;
    // Past a row's last cell with no row after it: a new one.
    if (row && row.index === row.rows.length - 1 && row.cells.at(-1) === found.block) return addRow(state, row);
    if (found.blocks.length < 2) return null;
    const next = found.blocks[found.index + dir];
    if (!next) {
      if (dir > 0 && isList(schema, found.component)) return addItem(state, found, schema);
      return { edits: [], selection: state.selection };
    }
    const { from, to } = innerOf(next);
    const text = state.text;
    // An empty line's `~`: the caret before it, as everywhere.
    if (isEmptyBlock(text, next)) return { edits: [], selection: { anchor: from, head: from } };
    return { edits: [], selection: { anchor: from, head: to } };
  };

type Found = NonNullable<ReturnType<typeof argsAt>>;

/**
 * In a component whose positional arguments are rows (a rubric's criteria, arrays of content
 * cells): its rows, and the one the caret's cell is in with its cells.
 */
const rowAt = (state: EditorState, found: Found, schema: EditorSchema) => {
  if (!schema.rows?.has(found.component.name)) return null;
  const rows = (callArgs(found.component.call, state.text)?.positional ?? []).filter((p) => p.kind === "Array");
  const index = rows.findIndex((r) => r.from < found.block.from && found.block.to < r.to);
  const row = rows[index];
  return row ? { rows, index, row, cells: row.children.filter((k) => k.kind === "ContentBlock") } : null;
};

type Row = NonNullable<ReturnType<typeof rowAt>>;

/** A row of empty cells after the last, as many as it has and set apart as the rows are; the caret in its first. */
const addRow = (state: EditorState, { rows, row, cells }: Row): Transaction => {
  const before = rows[rows.length - 2];
  const between = before ? state.text.slice(before.to, row.from) : ", ";
  const empty = cells.map(() => `[${EMPTY_LINE}]`).join(", ");
  const insert = `${between}(${empty}${cells.length === 1 ? "," : ""})`;
  const at = row.to + between.length + 2;
  return { edits: [{ from: row.to, to: row.to, insert }], selection: { anchor: at, head: at } };
};

/**
 * Edits to the argument that numbers one of a list component's items (`answer: 3`, or several:
 * `(1, 3)`) as items move: `to` gives an item's new number, or `null` when the item goes (no
 * number left: `none`).
 */
const renumber = (
  state: EditorState,
  component: Component,
  schema: EditorSchema,
  to: (n: number) => number | null,
): TextEdit[] => {
  const name = schema.indexes?.get(component.name);
  const value = name ? callArgs(component.call, state.text)?.named.get(name) : undefined;
  if (!value) return [];
  const src = (n: SyntaxNode) => state.text.slice(n.from, n.to);
  const numbers = value.kind === "Array" ? value.children.filter((c) => c.kind === "Int") : [value];
  const other = value.children.some((c) => !["LeftParen", "RightParen", "Comma", "Space", "Int"].includes(c.kind));
  if (numbers.some((n) => n.kind !== "Int") || (value.kind === "Array" && other)) return [];
  const next = numbers.map((n) => to(Number(src(n)))).filter((n) => n !== null);
  const insert =
    next.length === 0
      ? "none"
      : value.kind === "Int"
        ? String(next[0])
        : `(${next.join(", ")}${next.length === 1 ? "," : ""})`;
  return insert === src(value) ? [] : [{ from: value.from, to: value.to, insert }];
};

/** How much longer `edits` make the text before `at`. */
const grown = (edits: TextEdit[], at: number): number =>
  edits.reduce((d, e) => (e.to <= at ? d + e.insert.length - (e.to - e.from) : d), 0);

/** A new item after the caret's (`, [~]`), the caret in it. */
const addItem = (state: EditorState, found: Found, schema: EditorSchema): Transaction => {
  const { block, index, component } = found;
  const insert = `, [${EMPTY_LINE}]`;
  const numbers = renumber(state, component, schema, (n) => (n >= index + 2 ? n + 1 : n));
  const at = block.to + 3 + grown(numbers, block.to);
  return { edits: [{ from: block.to, to: block.to, insert }, ...numbers], selection: { anchor: at, head: at } };
};

/**
 * Enter in an item's text: two items, the text after the caret the second's. At the item's start,
 * an empty item before it. Nothing where that can't be written (the caret in a formula, or in
 * bold text: an item doesn't end inside it).
 */
const splitItem = (state: EditorState, found: Found, schema: EditorSchema): Transaction => {
  const { block, index, component, blocks } = found;
  const text = state.text;
  const at = state.selection.head;
  const stay: Transaction = { edits: [], selection: state.selection };
  if (!canType(state, at)) return stay;
  const { from, to } = innerOf(block);
  let a = at;
  while (a > from && (text[a - 1] === " " || text[a - 1] === "\t")) a--;
  let b = at;
  while (b < to && (text[b] === " " || text[b] === "\t")) b++;
  const first = a === from;
  const edit = first
    ? { from: block.from, to: block.from, insert: `[${EMPTY_LINE}], ` }
    : { from: a, to: b, insert: "], [" };
  const numbers = renumber(state, component, schema, (n) => (n >= index + (first ? 1 : 2) ? n + 1 : n));
  const head = (first ? at : a) + edit.insert.length + grown(numbers, a);
  const tr: Transaction = { edits: [edit, ...numbers], selection: { anchor: head, head } };
  const next = state.apply(tr).state;
  const after = componentsAt(next, component.from + 1, schema).find((c) => c.from === component.from);
  const split = after && contentBlocksIn(after.call).length === blocks.length + 1;
  return split && (!hasErrors(next.tree) || hasErrors(state.tree)) ? tr : stay;
};

/**
 * Enter in a component's content written on one line: in a list (a multiple choice), a new item
 * after this one, with the text after the caret; in a table's or rubric's cell, a line break; in a
 * statement (a true/false, a callout written on one line), out of the component, onto an empty
 * line after it. `null` elsewhere (content over several lines takes Enter as text does).
 * @beta
 */
export const enterArg: EditorCommand = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA) => {
  if (!state.empty) return null;
  const found = argsAt(state, schema);
  if (!found) return null;
  const text = state.text;
  const { from, to } = innerOf(found.block);
  if (text.slice(from, to).includes("\n")) return null;
  const at = state.selection.head;
  const atEnd = text.slice(at, to).trim() === "" || isEmptyBlock(text, found.block);
  if (isList(schema, found.component)) return atEnd ? addItem(state, found, schema) : splitItem(state, found, schema);
  // Only a plugin's components and tables: Enter in `#align(center)[…]` is a paragraph's.
  if (!schema.components?.has(found.component.name)) return null;
  if (found.blocks.length > 1) {
    // A cell: the line breaks there.
    return insertLineBreak(state, schema);
  }
  if (!atEnd) return null;
  return exitBlock(1)(state.select({ anchor: found.component.to, head: found.component.to }), schema);
};

/**
 * Backspace in an empty item of a list component (a multiple choice's option): the item goes, the
 * caret at the end of the one before. In an empty row's first cell (a rubric's criterion, after
 * the first): the row goes. `null` elsewhere.
 * @beta
 */
export const removeArg: EditorCommand = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA) => {
  if (!state.empty) return null;
  const found = argsAt(state, schema);
  if (!found || !isEmptyBlock(state.text, found.block)) return null;
  // Only from the item's start (or on its empty line's `~`).
  const { from } = innerOf(found.block);
  if (state.text.slice(from, state.selection.head).trim() !== "") return null;
  const row = rowAt(state, found, schema);
  if (row) {
    // A row with nothing in it, from its first cell: it goes, the caret at the end of the row before.
    const before = row.rows[row.index - 1];
    const last = before?.children.filter((k) => k.kind === "ContentBlock").at(-1);
    if (!before || !last || row.cells[0] !== found.block || !row.cells.every((c) => isEmptyBlock(state.text, c)))
      return null;
    return {
      edits: [{ from: before.to, to: row.row.to, insert: "" }],
      selection: { anchor: last.to - 1, head: last.to - 1 },
    };
  }
  if (!isList(schema, found.component)) return null;
  // The items after it are one earlier; its own number goes with it.
  const k = found.index + 1;
  const numbers = renumber(state, found.component, schema, (n) => (n === k ? null : n > k ? n - 1 : n));
  const prev = found.blocks[found.index - 1];
  if (prev) {
    // Back to the end of the item before: the separator and the item go.
    const edits = [{ from: prev.to, to: found.block.to, insert: "" }, ...numbers];
    const end = prev.to - 1 + grown(numbers, prev.to);
    return { edits, selection: { anchor: end, head: end } };
  }
  const next = found.blocks[found.index + 1];
  if (!next) return { edits: [], selection: state.selection };
  // The first: it and the separator after it go.
  const edits = [{ from: found.block.from, to: next.from, insert: "" }, ...numbers];
  const start = found.block.from + 1 + grown(numbers, found.block.from);
  return { edits, selection: { anchor: start, head: start } };
};

/** A string's text as markup that shows the same characters: straight quotes stay straight. */
const literal = (value: string): string => escapeMarkup(value).replace(/['"]/g, "\\$&");

/**
 * An argument written as code, as the content block that shows the same: a call (`[#ce("H2O")]`),
 * an equation (`[$x$]`), a string (`[Water]`). `null` for anything else (a number, a variable, a
 * string with a line break, which content would read as a space).
 */
const asContent = (text: string, node: SyntaxNode): string | null => {
  const src = text.slice(node.from, node.to);
  if (node.kind === "FuncCall") return `[#${src}]`;
  if (node.kind === "Equation") return `[${src}]`;
  if (node.kind !== "Str") return null;
  const value = readString(src);
  return value === null || /[\n\r\t]/.test(value) ? null : `[${literal(value)}]`;
};

/**
 * A click on what an argument written as code shows, `at` an offset in it (and `caret` the place
 * clicked, for a caret in a string's text): a formula among a
 * multiple choice's options (`#mcq(ce("H2"), ce("O2"))`), an answer (`answer: ce("H2O")`). A caret
 * has no place in code, so the argument is written as content, which shows the same, and is then
 * edited as any content is: a component in it (a call of `EditorSchema.components`) is selected, with
 * its own form (`[#ce("H2")]`); in a list component every item becomes content, a string its text
 * with the caret where it was clicked (`"Water"`: `[Water]`), an equation selected (`[$x$]`).
 * `null` where nothing is to rewrite: the text is content already, or no component's.
 * @beta
 */
export const argAsContent =
  (at: number, caret = at): EditorCommand =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const text = state.text;
    const path = pathAt(state.tree, at);
    // The call written in the text (`#mcq(…)`) whose code the offset is in: the innermost in markup.
    let outer = -1;
    for (let i = 1; i < path.length; i++) if (path[i]?.kind === "FuncCall" && path[i - 1]?.kind === "Markup") outer = i;
    const call = path[outer];
    if (!call || path.slice(outer).some((n) => n.kind === "ContentBlock")) return null;
    /** Whether the path's node at `i` is an argument of a call: positional, or a named one's value. */
    const isArgument = (i: number): boolean => {
      const parent = path[i - 1];
      if (parent?.kind === "Args") return path[i]?.kind !== "Named";
      return parent?.kind === "Named" && path[i - 2]?.kind === "Args" && path[i] !== parent.children[0];
    };
    // Inside an equation the calls are math's (`$frac(1, 2)$`), not arguments to rewrite.
    const math = path.findIndex((n, i) => i > outer && n.kind === "Equation");
    const end = math < 0 ? path.length : math;
    // The list's item clicked, with every other item written as code.
    const name = calleeName(call, text);
    const item = path[outer + 1]?.kind === "Args" && isArgument(outer + 2) ? path[outer + 2] : undefined;
    let targets: SyntaxNode[] = [];
    let focus: SyntaxNode | undefined;
    if (item && name !== null && schema.lists?.has(name) && asContent(text, item) !== null) {
      targets = (callArgs(call, text)?.positional ?? []).filter((p) => asContent(text, p) !== null);
      focus = item;
    } else {
      // A component among the arguments, the innermost: `answer: ce("H2O")`.
      for (let i = end - 1; i > outer && !focus; i--) {
        const n = path[i] as SyntaxNode;
        const callee = n.kind === "FuncCall" && isArgument(i) ? calleeName(n, text) : null;
        if (callee !== null && schema.components?.has(callee)) focus = n;
      }
      if (focus) targets = [focus];
    }
    if (!focus || !targets.includes(focus)) return null;
    const edits = targets.map((n) => ({ from: n.from, to: n.to, insert: asContent(text, n) as string }));
    const start = focus.from + grown(edits, focus.from);
    let selection: Transaction["selection"];
    if (focus.kind === "Str") {
      // The caret where the string was clicked, in its text as content.
      const value = readString(text.slice(focus.from, focus.to)) ?? "";
      const plain = !text.slice(focus.from, focus.to).includes("\\");
      const k = plain ? Math.max(0, Math.min(value.length, caret - focus.from - 1)) : value.length;
      const head = start + 1 + literal(value.slice(0, k)).length;
      selection = { anchor: head, head };
    } else {
      // `[#ce("H2")]`: the component from its `#`; `[$x$]`: the equation.
      const width = focus.to - focus.from + (focus.kind === "FuncCall" ? 1 : 0);
      selection = { anchor: start + 1, head: start + 1 + width, node: true };
    }
    const tr: Transaction = { edits, selection };
    return hasErrors(state.apply(tr).state.tree) && !hasErrors(state.tree) ? null : tr;
  };

/** The components among a call's arguments, written as code (`ce("H2O")`): the outermost ones. */
const componentArgs = (call: SyntaxNode, text: string, schema: EditorSchema): SyntaxNode[] => {
  const found: SyntaxNode[] = [];
  const visit = (node: SyntaxNode, argument: boolean) => {
    if (node.kind === "ContentBlock" || node.kind === "Equation") return;
    if (argument && node.kind === "FuncCall") {
      const name = calleeName(node, text);
      if (name !== null && schema.components?.has(name)) {
        found.push(node);
        return;
      }
    }
    // A call's arguments, and a named one's value: `mcq(ce("H2"), answer: ce("O2"))`.
    const args = node.kind === "Args";
    for (const c of node.children) visit(args && c.kind === "Named" ? (c.children.at(-1) ?? c) : c, args);
  };
  for (const c of call.children) visit(c, false);
  return found;
};

/**
 * A click on a component shown whole, the call at `from` (its `#`), whose arguments hold components
 * written as code (`#mcq(ce("H2"), ce("O2"))`), or which is a list of strings (`#mcq("Yes", "No")`).
 * Typst draws those in the component's package, so where each went on the page isn't known until
 * they are content: every one becomes content (`#mcq([#ce("H2")], [#ce("O2")])`, `#mcq([Yes], [No])`),
 * and the component stays selected. The pages of the new text then say which was clicked. `null`
 * with none.
 * @beta
 */
export const argsAsContent =
  (from: number): EditorCommand =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const text = state.text;
    const path = pathAt(state.tree, from + 1);
    const call = path.find((n, i) => n.kind === "FuncCall" && n.from === from + 1 && path[i - 1]?.kind === "Markup");
    if (!call || text[from] !== "#") return null;
    const components = componentArgs(call, text, schema);
    const name = calleeName(call, text);
    const items =
      name !== null && schema.lists?.has(name)
        ? (callArgs(call, text)?.positional ?? []).filter((p) => asContent(text, p) !== null)
        : [];
    if (!components.length && !items.length) return null;
    const targets = [...items, ...components.filter((c) => !items.some((i) => i.from <= c.from && c.to <= i.to))];
    const edits = targets
      .map((n) => ({ from: n.from, to: n.to, insert: asContent(text, n) as string }))
      .sort((a, b) => a.from - b.from);
    const tr: Transaction = {
      edits,
      selection: { anchor: from, head: call.to + grown(edits, call.to), node: true },
    };
    return hasErrors(state.apply(tr).state.tree) && !hasErrors(state.tree) ? null : tr;
  };
