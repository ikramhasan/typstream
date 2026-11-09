// Keys in a component's content arguments: the options of a multiple choice, a rubric's cells, a
// true/false's statement. Tab goes from one to the next as in a table; in a component whose
// positional content arguments are its items (`EditorSchema.lists`: a multiple choice), Enter at an
// item's end adds one and Backspace in an empty one removes it; elsewhere, Enter in content written
// on one line leaves the component (a statement doesn't become two paragraphs), or breaks the line in
// a cell.

import type { SyntaxNode } from "@typstream/syntax";
import { DEFAULT_SCHEMA, type EditorSchema, EMPTY_LINE, exitBlock } from "./commands";
import { type Component, componentAt } from "./components";
import type { EditorCommand } from "./plugin";
import type { EditorState, Transaction } from "./state";
import { contentBlocksIn } from "./tree";

/** The innermost component around the caret with content arguments, and the one holding the caret. */
const argsAt = (state: EditorState, schema: EditorSchema) => {
  const at = state.selection.head;
  const component = componentAt(state, at, schema);
  if (!component) return null;
  const blocks = contentBlocksIn(component.call);
  const index = blocks.findIndex((b) => b.from < at && at < b.to);
  if (index < 0) return null;
  return { component, blocks, index, block: blocks[index] as SyntaxNode };
};

/** Inside a content block's brackets. */
const innerOf = (b: SyntaxNode) => ({ from: b.from + 1, to: b.to - 1 });

/** Whether a content block holds nothing but whitespace or an empty line's `~`. */
const isEmptyBlock = (text: string, b: SyntaxNode) => /^\s*~?\s*$/.test(text.slice(b.from + 1, b.to - 1));

/** Whether the component's positional content arguments are its items. */
const isList = (schema: EditorSchema, c: Component) => schema.lists?.has(c.name) ?? false;

/**
 * Tab (`dir` 1) or Shift+Tab (-1) in a component's content: the next or previous one's text
 * selected; past a list's last item, a new item. `null` outside one (or in a table: `moveCell`).
 * @beta
 */
export const moveArg =
  (dir: 1 | -1): EditorCommand =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const found = argsAt(state, schema);
    if (!found || found.blocks.length < 2) return null;
    const next = found.blocks[found.index + dir];
    if (!next) {
      if (dir > 0 && isList(schema, found.component)) return addItem(state, found.block);
      return { edits: [], selection: state.selection };
    }
    const { from, to } = innerOf(next);
    const text = state.text;
    // An empty line's `~`: the caret before it, as everywhere.
    if (isEmptyBlock(text, next)) return { edits: [], selection: { anchor: from, head: from } };
    return { edits: [], selection: { anchor: from, head: to } };
  };

/** A new item after `block` (`, [~]`), the caret in it. */
const addItem = (state: EditorState, block: SyntaxNode): Transaction => {
  const insert = `, [${EMPTY_LINE}]`;
  const at = block.to + 3;
  return { edits: [{ from: block.to, to: block.to, insert }], selection: { anchor: at, head: at } };
};

/**
 * Enter in a component's content written on one line: in a list (a multiple choice), a new item
 * after this one when the caret is at its end; in a table's or rubric's cell, a line break; in a
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
  if (isList(schema, found.component)) return atEnd ? addItem(state, found.block) : null;
  // Only a plugin's components and tables: Enter in `#align(center)[…]` is a paragraph's.
  if (!schema.components?.has(found.component.name)) return null;
  if (found.blocks.length > 1) {
    // A cell: the line breaks there.
    const insert = text[at - 1] === " " ? "\\ " : " \\ ";
    return {
      edits: [{ from: at, to: at, insert }],
      selection: { anchor: at + insert.length, head: at + insert.length },
    };
  }
  if (!atEnd) return null;
  return exitBlock(1)(state.select({ anchor: found.component.to, head: found.component.to }), schema);
};

/**
 * Backspace in an empty item of a list component (a multiple choice's option): the item goes, the
 * caret at the end of the one before. `null` elsewhere.
 * @beta
 */
export const removeArg: EditorCommand = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA) => {
  if (!state.empty) return null;
  const found = argsAt(state, schema);
  if (!found || !isList(schema, found.component) || !isEmptyBlock(state.text, found.block)) return null;
  // Only from the item's start (or on its empty line's `~`).
  const { from } = innerOf(found.block);
  if (state.text.slice(from, state.selection.head).trim() !== "") return null;
  const text = state.text;
  const prev = found.blocks[found.index - 1];
  if (prev) {
    // Back to the end of the item before: the separator and the item go.
    const edits = [{ from: prev.to, to: found.block.to, insert: "" }];
    const end = prev.to - 1;
    return { edits, selection: { anchor: end, head: end } };
  }
  const next = found.blocks[found.index + 1];
  if (!next) return { edits: [], selection: state.selection };
  // The first: it and the separator after it go.
  const edits = [{ from: found.block.from, to: next.from, insert: "" }];
  void text;
  return { edits, selection: { anchor: found.block.from + 1, head: found.block.from + 1 } };
};
