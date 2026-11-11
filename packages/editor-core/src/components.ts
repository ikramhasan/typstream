// Components: calls that show as a block or an inline piece of their own (a table, an edu question,
// a mind map, an image), as opposed to marks. The editor finds the one at the caret, edits its
// named arguments (from a form, so nobody writes Typst), and inserts new ones from a plugin's
// templates.

import type { TextEdit } from "@typstream/core";
import type { SyntaxNode } from "@typstream/syntax";
import {
  blocksAround,
  canType,
  caretPlace,
  chain,
  DEFAULT_SCHEMA,
  type EditorSchema,
  emptyLineAt,
  isEmptyLine,
  splitBlock,
} from "./commands";
import type { EditorState, Selection, Transaction } from "./state";
import { EMPTY_LINE } from "./text";
import { type Block, blocksOf, callArgs, calleeName, findLast, isEmbedded } from "./tree";

/**
 * A component in the source: a call embedded in markup (`#question(…)[…]`) that isn't a mark.
 * @beta
 */
export interface Component {
  /** The function called: `table`, `question`, `mindmap`. */
  name: string;
  /** Start of its `#`. */
  from: number;
  /** End of the call. */
  to: number;
  /** The `FuncCall` node. */
  call: SyntaxNode;
}

/**
 * The components containing `offset`, innermost first (a table in a question: the table, then the
 * question). With `names`, only calls of those functions.
 * @beta
 */
export const componentsAt = (
  state: EditorState,
  offset: number,
  schema: EditorSchema = DEFAULT_SCHEMA,
  names?: ReadonlySet<string>,
): Component[] => {
  const text = state.text;
  const out: Component[] = [];
  const visit = (node: SyntaxNode) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      const next = kids[i + 1];
      if (c.kind === "Hash" && next && next.kind === "FuncCall" && c.from <= offset && offset <= next.to) {
        const name = calleeName(next, text);
        if (name && !schema.marks.has(name) && (!names || names.has(name)))
          out.push({ name, from: c.from, to: next.to, call: next });
      }
      if (c.to < offset || c.from > offset) continue;
      if (c.children.length) visit(c);
    }
  };
  visit(state.tree);
  return out.reverse();
};

/** The innermost component at `offset`, of `names` if given. @beta */
export const componentAt = (
  state: EditorState,
  offset: number,
  schema?: EditorSchema,
  names?: ReadonlySet<string>,
): Component | null => componentsAt(state, offset, schema, names)[0] ?? null;

/** The component whose call is exactly `[from, to)` (a node selection). @beta */
export const componentIn = (
  state: EditorState,
  from: number,
  to: number,
  schema: EditorSchema = DEFAULT_SCHEMA,
): Component | null => componentsAt(state, from + 1, schema).find((c) => c.from === from && c.to === to) ?? null;

/**
 * A named argument's Typst source (`2` for `points: 2`), or `null` when the call doesn't write it.
 * @beta
 */
export const argumentOf = (state: EditorState, component: Component, name: string): string | null => {
  const args = callArgs(component.call, state.text);
  const v = args?.named.get(name);
  return v ? state.text.slice(v.from, v.to) : null;
};

/**
 * Sets a named argument to `value` (Typst source), or removes it with `null`: the value replaced
 * in place, or `name: value` added to the parentheses (written if the call had none).
 * @beta
 */
export const setArgument =
  (component: Component, name: string, value: string | null) =>
  (state: EditorState): Transaction | null => {
    const text = state.text;
    const args = callArgs(component.call, text);
    if (!args) return null;
    const named = args.namedNodes.get(name);
    let edit: TextEdit;
    if (named) {
      if (value === null) {
        // The argument and the comma after it (or before it, if it is the last).
        let from = named.from;
        let to = named.to;
        const after = /^\s*,\s*/.exec(text.slice(to));
        // On a line of its own: the line goes.
        const start = text.lastIndexOf("\n", from - 1) + 1;
        const own = /^[ \t]*,[ \t]*\n/.exec(text.slice(to));
        if (own && text.slice(start, from).trim() === "") {
          from = start;
          to += own[0].length;
        } else if (after) to += after[0].length;
        else {
          const before = /,\s*$/.exec(text.slice(args.parens?.from ?? from, from));
          if (before) from -= before[0].length;
        }
        edit = { from, to, insert: "" };
        // `f()[…]`: the empty parentheses go too.
        const rest = text.slice(args.parens?.from ?? 0, args.parens?.to ?? 0);
        if (args.parens && rest.length - (to - from) <= 2 && args.trailing.length > 0)
          edit = { from: args.parens.from, to: args.parens.to, insert: "" };
      } else {
        const v = args.named.get(name) as SyntaxNode;
        edit = { from: v.from, to: v.to, insert: value };
      }
    } else {
      if (value === null) return null;
      if (args.parens) {
        const inside = text.slice(args.parens.from + 1, args.parens.to - 1);
        const comma = /,\s*$/.test(inside);
        // A call written an argument a line gets a line for this one, indented as the first is.
        const line = /^[ \t]*\n([ \t]*)\S/.exec(inside);
        const sep = inside.trim() === "" ? "" : line ? `${comma ? "" : ","}\n${line[1]}` : comma ? " " : ", ";
        const at = args.parens.to - 1 - (/\s*$/.exec(inside)?.[0].length ?? 0);
        edit = { from: at, to: at, insert: `${sep}${name}: ${value}${line ? "," : ""}` };
      } else {
        const callee = component.call.children[0] as SyntaxNode;
        edit = { from: callee.to, to: callee.to, insert: `(${name}: ${value})` };
      }
    }
    return { edits: [edit], selection: keep(state.selection, edit) };
  };

/** A selection kept through `edit`, as the component around it moves or grows. */
const keep = (s: Selection, edit: TextEdit): Selection => {
  const shift = edit.insert.length - (edit.to - edit.from);
  const map = (p: number) =>
    p > edit.from || (p === edit.from && edit.from !== edit.to) ? (p >= edit.to ? p + shift : edit.from) : p;
  return s.node
    ? { anchor: Math.min(s.anchor, s.head), head: Math.max(s.anchor, s.head) + shift, node: true }
    : { anchor: map(s.anchor), head: map(s.head) };
};

/** Where `{{cursor}}` marks the caret in a template; removed before inserting. @beta */
export const CURSOR = "{{cursor}}";

/** A template's last line when it is an empty one for the caret: what a page break leaves to type on. */
const EMPTY_TAIL = `\n\n${CURSOR}${EMPTY_LINE}`;

/**
 * Inserts `template` (Typst, with an optional `{{cursor}}` for the caret) as a block of its own:
 * on the caret's empty line; in the middle of a paragraph, between its two halves; at a block's
 * start, above it; else after the block the caret is in. Its lines take the indentation of the
 * markup there (inside an indented `[…]`). Without a cursor, the new component is selected. A page
 * break goes after the outermost block (in a table's cell or a question it is an error), and the
 * empty line a template ends with is left out where text follows: the caret goes to that text.
 * @beta
 */
export const insertBlock =
  (template: string) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction => {
    const text = state.text;
    const at = state.selection.node ? state.to : state.from;
    const tail = template.endsWith(EMPTY_TAIL);
    const around = blocksAround(state, at, schema);
    // Only between the document's own blocks: a page break.
    const outer = /^#pagebreak\b/.test(template) && around.markup !== state.tree;
    const blocks = outer ? blocksOf(state.tree, text, (name) => schema.inline.has(name)) : around.blocks;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const lineEndRaw = text.indexOf("\n", at);
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    const line = text.slice(lineStart, lineEnd);
    const indent = outer ? "" : (/^[ \t]*/.exec(line)?.[0] ?? "");
    const indented = (t: string) => t.replace(/\n/g, `\n${indent}`);
    const tilde = line.indexOf("~");
    if (!outer && (line.trim() === "" || (line.trim() === "~" && isEmptyLine(text, lineStart + tilde)))) {
      // An empty line (an empty line's `~` included): the component goes there, apart from what is around.
      const before = text.slice(0, lineStart);
      const prefix =
        before.trim() === "" || /\n[ \t]*\n[ \t]*$/.test(before) || /\[[ \t]*\n?[ \t]*$/.test(before) ? "" : "\n";
      const after = text.slice(lineEnd);
      const suffix = after.trim() === "" || /^\n[ \t]*\n/.test(after) || /^\s*\]/.test(after) ? "" : "\n";
      return place(state, { from: lineStart + indent.length, to: lineEnd, prefix, body: indented(template), suffix });
    }
    const block = blocks.find((b) => b.from <= at && at <= b.to) ?? findLast(blocks, (b) => b.to <= at);
    const isList = (b: Block) => b.kind === "list" || b.kind === "enum" || b.kind === "term";
    // In the middle of a paragraph: it splits there, and the component goes between the halves.
    if (
      !outer &&
      state.empty &&
      block?.kind === "paragraph" &&
      text.slice(block.from, at).trim() !== "" &&
      text.slice(at, block.to).trim() !== "" &&
      canType(state, at)
    ) {
      const split = splitBlock(state, schema);
      const mid = split ? state.apply(split).state : null;
      if (mid && blocksAround(mid, mid.selection.head, schema).blocks.some((b) => b.from === mid.selection.head))
        return chain(state, mid, insertBlock(template)(mid, schema));
    }
    // At a block's start (a list's: its first item's): above it.
    const first =
      block &&
      !(
        isList(block) &&
        blocks.some((b) => b.kind === block.kind && b.to <= block.from && text.slice(b.to, block.from).trim() === "")
      );
    if (
      !outer &&
      block &&
      first &&
      !state.selection.node &&
      caretPlace(state, at, schema) === caretPlace(state, block.from, schema)
    ) {
      const own = text.slice(text.lastIndexOf("\n", block.from - 1) + 1, block.from).trim() === "";
      const from = own ? text.lastIndexOf("\n", block.from - 1) + 1 : block.from;
      const blank =
        text.slice(0, from).trim() === "" ||
        /\n[ \t]*\n$/.test(text.slice(0, from)) ||
        /\[[ \t]*\n?$/.test(text.slice(0, from));
      const body = indented(tail ? template.slice(0, -EMPTY_TAIL.length) : template);
      const tr = place(state, {
        from,
        to: from,
        prefix: own ? (blank ? "" : "\n") + indent : "",
        body,
        suffix: own ? "\n\n" : `\n\n${indent}`,
      });
      return tail ? toNext(state, tr, schema) : tr;
    }
    let from = block ? block.to : lineEnd;
    // After a list item, the component would continue it: after the whole list.
    if (block && isList(block)) {
      let last = block;
      for (const b of blocks)
        if (b.from >= last.to && b.kind === block.kind && text.slice(last.to, b.from).trim() === "") last = b;
      from = last.to;
    }
    const after = text.slice(from);
    const follows = after.trim() !== "" && !/^\s*\]/.test(after);
    const suffix = !follows || /^[ \t]*\n[ \t]*\n/.test(after) ? "" : "\n";
    const body = indented(tail && follows ? template.slice(0, -EMPTY_TAIL.length) : template);
    const tr = place(state, { from, to: from, prefix: `\n\n${indent}`, body, suffix });
    return tail && follows ? toNext(state, tr, schema) : tr;
  };

/** `tr` (an insertion) with the caret at the start of the text after what it inserts. */
const toNext = (state: EditorState, tr: Transaction, schema: EditorSchema): Transaction => {
  const edit = tr.edits[0];
  if (!edit) return tr;
  const next = state.apply(tr).state;
  let at = edit.from + edit.insert.length;
  while (at < next.text.length && /\s/.test(next.text[at] as string)) at++;
  at = caretPlace(next, at, schema);
  return { edits: tr.edits, selection: { anchor: at, head: at } };
};

const place = (
  state: EditorState,
  { from, to, prefix, body, suffix }: { from: number; to: number; prefix: string; body: string; suffix: string },
): Transaction => {
  const cursor = body.indexOf(CURSOR);
  const clean = body.replace(CURSOR, "");
  const insert = prefix + clean + suffix;
  const start = from + prefix.length;
  const selection: Selection =
    cursor >= 0 ? sample(clean, cursor, start) : { anchor: start, head: start + clean.length, node: true };
  void state;
  return { edits: [{ from, to, insert }], selection };
};

/**
 * The caret at a template's `{{cursor}}`, with the sample text after it selected (`The statement`
 * up to the content block's end), so what is typed replaces it.
 */
const sample = (clean: string, cursor: number, start: number): Selection => {
  const text = /^[^[\]#$\n]*/.exec(clean.slice(cursor))?.[0] ?? "";
  const end = clean[cursor + text.length];
  // Not an empty line's `~`: the caret stands before it, and typing replaces it anyway.
  const shown = text.trim() !== "" && text.trim() !== "~";
  const length = shown && (end === "]" || end === "\n") ? text.replace(/\s+$/, "").length : 0;
  return { anchor: start + cursor, head: start + cursor + length };
};

/**
 * Inserts `template` (Typst, with an optional `{{cursor}}`) at the caret, in the text: an inline
 * piece (an inline equation, a blank to fill in). With a selection, after it.
 * @beta
 */
export const insertInline =
  (template: string) =>
  (state: EditorState): Transaction => {
    // On an empty line, in place of its `~`; after what is selected, which stays.
    const empty = state.empty ? emptyLineAt(state.text, state.from) : -1;
    const from = empty >= 0 ? empty : state.to;
    const to = empty >= 0 ? empty + 1 : state.to;
    const cursor = template.indexOf(CURSOR);
    const clean = template.replace(CURSOR, "");
    // A space before, if it would stick to a word (`a#blank()` is fine; `$x$` needs nothing).
    const selection: Selection =
      cursor >= 0 ? sample(clean, cursor, from) : { anchor: from, head: from + clean.length, node: true };
    return { edits: [{ from, to, insert: clean }], selection };
  };

/**
 * Deletes the piece at `[from, to)` (a component, a table, an equation). One on a line of its own
 * goes with its line, and the blank lines around it become one, so the text after it starts where
 * a paragraph does (not indented, no empty line left); the caret goes to the start of what follows.
 * @beta
 */
export const deleteBlock =
  (from: number, to: number) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction => {
    const text = state.text;
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const eol = text.indexOf("\n", to);
    const lineEnd = eol < 0 ? text.length : eol;
    if (text.slice(lineStart, from).trim() !== "" || text.slice(to, lineEnd).trim() !== "")
      return { edits: [{ from, to, insert: "" }], selection: { anchor: from, head: from } };
    // Its lines and the whitespace after them, then the break that kept it apart, as one.
    let a = lineStart;
    let b = lineEnd;
    while (b < text.length && /\s/.test(text[b] as string)) b++;
    while (a > 0 && /\s/.test(text[a - 1] as string)) a--;
    // What separated it from its neighbours, once: the text after it keeps its indentation.
    const indent = (() => {
      const start = text.lastIndexOf("\n", b - 1) + 1;
      return /^[ \t]*/.exec(text.slice(start, b))?.[0] ?? "";
    })();
    // On the line after a paragraph's or an item's text with the next line right under it (answer
    // lines in a list item): the lines around it stay as close.
    const close = !/\n[ \t]*\n/.test(text.slice(a, lineStart)) && !/\n[ \t]*\n/.test(text.slice(lineEnd, b));
    let insert: string;
    if (b >= text.length) insert = "";
    else if (a === 0) insert = indent;
    else if (text[a - 1] === "[" || text[b] === "]" || close) insert = `\n${indent}`;
    else insert = `\n\n${indent}`;
    const edits = [{ from: a, to: b, insert }];
    // At the start of what follows, where a caret stands there (after a heading's marker).
    const next = state.apply({ edits, selection: { anchor: a, head: a } }).state;
    const at = caretPlace(next, a + insert.length, schema);
    return { edits, selection: { anchor: at, head: at } };
  };

/** Every component call in the document, outermost first, for outlines and tests. @beta */
export const componentsIn = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Component[] => {
  const out: Component[] = [];
  const text = state.text;
  const visit = (node: SyntaxNode) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      const next = kids[i + 1];
      if (c.kind === "Hash" && next && isEmbedded(next) && next.kind === "FuncCall") {
        const name = calleeName(next, text);
        if (name && !schema.marks.has(name)) out.push({ name, from: c.from, to: next.to, call: next });
      }
      if (c.children.length) visit(c);
    }
  };
  visit(state.tree);
  return out;
};
