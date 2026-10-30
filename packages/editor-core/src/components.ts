// Components: calls that show as a block or an inline piece of their own (a table, an edu question,
// a mind map, an image), as opposed to marks. The editor finds the one at the caret, edits its
// named arguments (from a form, so nobody writes Typst), and inserts new ones from a plugin's
// templates.

import type { TextEdit } from "@typstream/core";
import type { SyntaxNode } from "@typstream/syntax";
import { blocksAround, DEFAULT_SCHEMA, type EditorSchema } from "./commands";
import type { EditorState, Selection, Transaction } from "./state";
import { calleeName, callArgs, findLast, isEmbedded } from "./tree";

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
        if (name && !schema.marks.has(name) && (!names || names.has(name))) out.push({ name, from: c.from, to: next.to, call: next });
      }
      if (c.to < offset || c.from > offset) continue;
      if (c.children.length) visit(c);
    }
  };
  visit(state.tree);
  return out.reverse();
};

/** The innermost component at `offset`, of `names` if given. @beta */
export const componentAt = (state: EditorState, offset: number, schema?: EditorSchema, names?: ReadonlySet<string>): Component | null =>
  componentsAt(state, offset, schema, names)[0] ?? null;

/** The component whose call is exactly `[from, to)` (a node selection). @beta */
export const componentIn = (state: EditorState, from: number, to: number, schema: EditorSchema = DEFAULT_SCHEMA): Component | null =>
  componentsAt(state, from + 1, schema).find((c) => c.from === from && c.to === to) ?? null;

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
        if (after) to += after[0].length;
        else {
          const before = /,\s*$/.exec(text.slice(args.parens?.from ?? from, from));
          if (before) from -= before[0].length;
        }
        edit = { from, to, insert: "" };
        // `f()[…]`: the empty parentheses go too.
        const rest = text.slice(args.parens?.from ?? 0, args.parens?.to ?? 0);
        if (args.parens && rest.length - (to - from) <= 2 && args.trailing.length > 0) edit = { from: args.parens.from, to: args.parens.to, insert: "" };
      } else {
        const v = args.named.get(name) as SyntaxNode;
        edit = { from: v.from, to: v.to, insert: value };
      }
    } else {
      if (value === null) return null;
      if (args.parens) {
        const inside = text.slice(args.parens.from + 1, args.parens.to - 1);
        const sep = inside.trim() === "" ? "" : /,\s*$/.test(inside) ? " " : ", ";
        const at = args.parens.to - 1 - (/\s*$/.exec(inside)?.[0].length ?? 0);
        edit = { from: at, to: at, insert: `${sep}${name}: ${value}` };
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
  const map = (p: number) => (p > edit.from || (p === edit.from && edit.from !== edit.to) ? (p >= edit.to ? p + shift : edit.from) : p);
  return s.node ? { anchor: Math.min(s.anchor, s.head), head: Math.max(s.anchor, s.head) + shift, node: true } : { anchor: map(s.anchor), head: map(s.head) };
};

/** Where `{{cursor}}` marks the caret in a template; removed before inserting. */
export const CURSOR = "{{cursor}}";

/**
 * Inserts `template` (Typst, with an optional `{{cursor}}` for the caret) as a block of its own:
 * on the caret's empty line, or after the block the caret is in. Its lines take the indentation of
 * the markup there (inside an indented `[…]`). Without a cursor, the new component is selected.
 * @beta
 */
export const insertBlock =
  (template: string) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction => {
    const text = state.text;
    const at = state.selection.node ? state.to : state.from;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const lineEndRaw = text.indexOf("\n", at);
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    const line = text.slice(lineStart, lineEnd);
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    const body = template.replace(/\n/g, `\n${indent}`);
    let from: number;
    let prefix: string;
    let suffix: string;
    if (line.trim() === "") {
      // An empty line: the component goes there, apart from what is around.
      from = lineStart + indent.length;
      const before = text.slice(0, lineStart);
      prefix = before.trim() === "" || /\n[ \t]*\n[ \t]*$/.test(before) ? "" : "\n";
      const after = text.slice(lineEnd);
      suffix = after.trim() === "" || /^\n[ \t]*\n/.test(after) ? "" : "\n";
      return place(state, { from, to: lineEnd, prefix, body, suffix });
    }
    const { blocks } = blocksAround(state, at, schema);
    const block = blocks.find((b) => b.from <= at && at <= b.to) ?? findLast(blocks, (b) => b.to <= at);
    from = block ? block.to : lineEnd;
    // After a list item, the component would continue it: after the whole list.
    if (block && (block.kind === "list" || block.kind === "enum" || block.kind === "term")) {
      let last = block;
      for (const b of blocks) if (b.from >= last.to && b.kind === block.kind && text.slice(last.to, b.from).trim() === "") last = b;
      from = last.to;
    }
    prefix = `\n\n${indent}`;
    const after = text.slice(from);
    suffix = after.trim() === "" || /^[ \t]*\n[ \t]*\n/.test(after) ? "" : `\n`;
    return place(state, { from, to: from, prefix, body, suffix });
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
    cursor >= 0 ? { anchor: start + cursor, head: start + cursor } : { anchor: start, head: start + clean.length, node: true };
  void state;
  return { edits: [{ from, to, insert }], selection };
};

/**
 * Inserts `template` (Typst, with an optional `{{cursor}}`) at the caret, in the text: an inline
 * piece (an inline equation, a blank to fill in).
 * @beta
 */
export const insertInline =
  (template: string) =>
  (state: EditorState): Transaction => {
    const from = state.from;
    const to = state.to;
    const cursor = template.indexOf(CURSOR);
    const clean = template.replace(CURSOR, "");
    // A space before, if it would stick to a word (`a#blank()` is fine; `$x$` needs nothing).
    const selection: Selection =
      cursor >= 0 ? { anchor: from + cursor, head: from + cursor } : { anchor: from, head: from + clean.length, node: true };
    return { edits: [{ from, to, insert: clean }], selection };
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
