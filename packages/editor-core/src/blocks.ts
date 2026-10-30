// Block formatting: paragraph, heading levels, bulleted and numbered lists, indentation and
// alignment, for every block the selection touches in the markup around it. A heading or list item
// is a marker at the start of a line in Typst (`== `, `- `, `+ `); alignment is an `#align(…)[…]`
// around the block.

import type { TextEdit } from "@typstream/core";
import type { SyntaxNode } from "@typstream/syntax";
import { blocksAround, DEFAULT_SCHEMA, type EditorSchema } from "./commands";
import { type EditorState, mapThrough, type Selection, type Transaction } from "./state";
import { type Block, callArgs, calleeName, pathAt } from "./tree";

/**
 * What a block is: a paragraph, a heading (level 1–6), or an item of a bulleted (`list`), numbered
 * (`enum`) or term list.
 * @beta
 */
export type BlockType =
  | { kind: "paragraph" }
  | { kind: "heading"; level: number }
  | { kind: "list" }
  | { kind: "enum" }
  | { kind: "term" };

/** The blocks of the markup around the selection that it touches. */
const selectedBlocks = (state: EditorState, schema: EditorSchema): { blocks: Block[]; all: Block[] } => {
  const { blocks } = blocksAround(state, state.from, schema);
  const touched = blocks.filter((b) => b.to >= state.from && b.from <= state.to);
  if (touched.length) return { blocks: touched, all: blocks };
  // A caret on an empty line: no block yet.
  return { blocks: [], all: blocks };
};

/** The type of the block the caret is in. @beta */
export const blockType = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): BlockType | null => {
  const { blocks } = selectedBlocks(state, schema);
  const b = blocks[0];
  if (!b) return null;
  if (b.kind === "heading") return { kind: "heading", level: headingLevel(b.node as SyntaxNode) };
  if (b.kind === "list" || b.kind === "enum" || b.kind === "term") return { kind: b.kind };
  if (b.kind === "paragraph") return { kind: "paragraph" };
  return null;
};

const headingLevel = (heading: SyntaxNode): number => {
  const marker = heading.children[0] as SyntaxNode;
  return marker.to - marker.from;
};

/** The source of a block's text without its marker, its lines joined (a heading is one line). */
const MARKERS: Record<string, string> = { list: "- ", enum: "+ ", term: "/ " };

/**
 * Makes every block the selection touches `type`. A paragraph's lines are joined: a heading or an
 * item is one line in Typst. Blocks that become paragraphs keep a blank line around them. Items
 * that become a list are joined into one (no blank lines between them).
 * @beta
 */
export const setBlockType =
  (type: BlockType) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const { blocks } = selectedBlocks(state, schema);
    const text = state.text;
    if (blocks.length === 0) {
      // An empty line: write the marker, to type after.
      if (type.kind === "paragraph") return null;
      const marker = type.kind === "heading" ? `${"=".repeat(type.level)} ` : (MARKERS[type.kind] as string);
      const at = state.from;
      return {
        edits: [{ from: at, to: at, insert: marker }],
        selection: { anchor: at + marker.length, head: at + marker.length },
      };
    }
    const edits: TextEdit[] = [];
    blocks.forEach((b, i) => {
      if (b.kind === "expression") return;
      const markerEnd = markerEndOf(b);
      const marker =
        type.kind === "paragraph"
          ? ""
          : type.kind === "heading"
            ? `${"=".repeat(type.level)} `
            : (MARKERS[type.kind] as string);
      const oneLine = type.kind === "paragraph" ? null : joinLines(text, markerEnd, b.to);
      edits.push({ from: b.from, to: markerEnd, insert: marker });
      if (oneLine) edits.push(...oneLine);
      // Between two selected blocks: a blank line for paragraphs and headings, a line break in a list.
      const next = blocks[i + 1];
      if (next && next.kind !== "expression") {
        const gap = text.slice(b.to, next.from);
        const want = type.kind === "list" || type.kind === "enum" || type.kind === "term" ? "\n" : "\n\n";
        if (gap.trim() === "" && gap !== want && !gap.startsWith(want.length === 1 ? "\n" : "\n\n"))
          edits.push({ from: b.to, to: next.from, insert: want });
        else if (gap.trim() === "" && want === "\n" && gap !== "\n")
          edits.push({ from: b.to, to: next.from, insert: want });
      }
    });
    // A paragraph or heading needs blank lines around it where it sat in a list.
    const first = blocks[0] as Block;
    const last = blocks[blocks.length - 1] as Block;
    if (type.kind === "paragraph" || type.kind === "heading") {
      const before = text.slice(0, first.from);
      if (before.trim() !== "" && !/\n[ \t]*\n[ \t]*$/.test(before) && /\n[ \t]*$/.test(before))
        edits.push({ from: first.from, to: first.from, insert: "\n" });
      const after = text.slice(last.to);
      if (after.trim() !== "" && !/^[ \t]*\n[ \t]*\n/.test(after) && /^[ \t]*\n/.test(after))
        edits.push({ from: last.to, to: last.to, insert: "\n" });
    }
    const merged = mergeTouching(edits);
    return { edits: merged, selection: mapBlockSelection(state.selection, merged, new Set(blocks.map((b) => b.from))) };
  };

/** Where a block's text starts: after its marker and the space after it. */
const markerEndOf = (b: Block): number => {
  if (!b.node || b.kind === "paragraph" || b.kind === "expression") return b.from;
  const body = b.node.children.find((k) => k.kind === "Markup");
  return body ? body.from : b.to;
};

/** Edits that put a block's lines on one line: each newline (and the indentation after it) becomes a space. */
const joinLines = (text: string, from: number, to: number): TextEdit[] => {
  const out: TextEdit[] = [];
  const re = /[ \t]*\n[ \t]*/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    if (m.index + m[0].length > to) break;
    out.push({ from: m.index, to: m.index + m[0].length, insert: " " });
  }
  return out;
};

const mergeTouching = (edits: TextEdit[]): TextEdit[] => {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: TextEdit[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && e.from < last.to) {
      // Overlapping: the later one's text after the earlier.
      last.to = Math.max(last.to, e.to);
      last.insert += e.insert;
    } else out.push({ ...e });
  }
  return out;
};

/**
 * A selection through block edits: past markers written at a block's start, before newlines added
 * at its end.
 */
const mapBlockSelection = (s: Selection, edits: TextEdit[], markersAt: ReadonlySet<number>): Selection => {
  const map = (pos: number) => mapThrough(pos, edits, markersAt.has(pos) ? 1 : -1);
  return { anchor: map(s.anchor), head: map(s.head) };
};

/**
 * Turns the selected blocks into a list of `kind`, or back into paragraphs if they all are one.
 * @beta
 */
export const toggleList =
  (kind: "list" | "enum") =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const { blocks } = selectedBlocks(state, schema);
    const all = blocks.length > 0 && blocks.every((b) => b.kind === kind || b.kind === "expression");
    return setBlockType(all ? { kind: "paragraph" } : { kind })(state, schema);
  };

/**
 * Indents (`dir` 1) or outdents (-1) the selected list items by two spaces, the lines of their
 * text and nested items included: Typst nests list items by indentation.
 * @beta
 */
export const indentItems =
  (dir: 1 | -1) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const text = state.text;
    const items = itemsInSelection(state);
    if (items.length === 0) return null;
    const edits: TextEdit[] = [];
    const seen = new Set<number>();
    for (const item of items) {
      let line = text.lastIndexOf("\n", item.from - 1) + 1;
      while (line <= item.to && line < text.length + 1) {
        if (!seen.has(line)) {
          seen.add(line);
          if (dir > 0) edits.push({ from: line, to: line, insert: "  " });
          else {
            let n = 0;
            while (n < 2 && text[line + n] === " ") n++;
            if (n) edits.push({ from: line, to: line + n, insert: "" });
          }
        }
        const next = text.indexOf("\n", line);
        if (next < 0 || next >= item.to) break;
        line = next + 1;
      }
    }
    void schema;
    if (edits.length === 0) return null;
    const sorted = edits.sort((a, b) => a.from - b.from);
    return { edits: sorted, selection: mapBlockSelection(state.selection, sorted, new Set(sorted.map((e) => e.from))) };
  };

/** List, enum and term items the selection touches, outermost. */
const itemsInSelection = (state: EditorState): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    for (const c of node.children) {
      if (c.to < state.from || c.from > state.to) continue;
      if (c.kind === "ListItem" || c.kind === "EnumItem" || c.kind === "TermItem") {
        // The innermost item holding the caret, or every item a selection touches.
        const inner = c.children.find((k) => k.kind === "Markup");
        const nested = inner?.children.some(
          (k) => (k.kind === "ListItem" || k.kind === "EnumItem") && k.from <= state.to && k.to >= state.from,
        );
        if (
          nested &&
          state.from >= (inner?.children.find((k) => k.kind === "ListItem" || k.kind === "EnumItem")?.from ?? Infinity)
        )
          visit(inner as SyntaxNode);
        else out.push(c);
      } else if (c.kind === "Markup" || c.kind === "ContentBlock" || c.kind === "FuncCall" || c.kind === "Args")
        visit(c);
    }
  };
  visit(state.tree);
  return out;
};

/**
 * An alignment: `left`, `center` or `right`. (No justified text: the layout profile pages are laid
 * out with sets ragged right, so a DOCX export matches them, #129.)
 * @beta
 */
export type Alignment = "left" | "center" | "right";

/** The alignment of the block the caret is in: of an `#align(…)` around it. @beta */
export const alignmentAt = (state: EditorState): Alignment => {
  const path = pathAt(state.tree, state.from, -1);
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i] as SyntaxNode;
    if (n.kind !== "FuncCall") continue;
    const name = calleeName(n, state.text);
    const args = callArgs(n, state.text);
    if (name === "align" && args?.positional[0]) {
      const v = state.text.slice(args.positional[0].from, args.positional[0].to);
      if (v === "center" || v === "right" || v === "left") return v;
    }
  }
  return "left";
};

/**
 * Aligns the blocks the selection touches: an `#align(…)[…]` around them (one for a run of
 * blocks), changed or taken off if they already have one.
 * @beta
 */
export const setAlignment =
  (align: Alignment) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const text = state.text;
    // Already in an `#align(…)[…]`: change it, or unwrap it.
    const path = pathAt(state.tree, state.from, -1);
    for (let i = path.length - 1; i >= 1; i--) {
      const n = path[i] as SyntaxNode;
      if (n.kind !== "FuncCall") continue;
      const name = calleeName(n, text);
      if (name !== "align") continue;
      const args = callArgs(n, text);
      const block = args?.trailing[0];
      const inner = block?.children.find((k) => k.kind === "Markup");
      const hash = (path[i - 1] as SyntaxNode).children.find((k) => k.kind === "Hash" && k.to === n.from);
      if (!args || !inner || !hash) continue;
      const body = text.slice(inner.from, inner.to);
      const insert = align === "left" ? body : wrapAlign(align, body);
      const edits = [{ from: hash.from, to: n.to, insert }];
      // The text moves by how much its opening changed.
      const delta = (align === "left" ? 0 : alignOpen(align).length) - (inner.from - hash.from);
      return { edits, selection: { anchor: state.selection.anchor + delta, head: state.selection.head + delta } };
    }
    if (align === "left") return null;
    const { blocks } = selectedBlocks(state, schema);
    if (blocks.length === 0) return null;
    const from = (blocks[0] as Block).from;
    const to = (blocks[blocks.length - 1] as Block).to;
    const open = alignOpen(align);
    const edits = [
      { from, to: from, insert: open },
      { from: to, to, insert: "]" },
    ];
    return { edits, selection: mapBlockSelection(state.selection, edits, new Set([from])) };
  };

const alignOpen = (align: Alignment): string => `#align(${align})[`;
const wrapAlign = (align: Alignment, body: string): string => `${alignOpen(align)}${body}]`;
