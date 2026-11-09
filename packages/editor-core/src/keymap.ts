// The editor's own keys, as a plugin at the lowest priority: Enter, Backspace, Delete, Tab and the
// rest are commands bound in a keymap like any plugin's, so a plugin binds the same key to do
// something else where it applies (Enter in its component) and the editor's command runs where it
// doesn't. What only the view can do (arrows, Home/End, pages up and down, undo) stays in the view.

import { indentItems } from "./blocks";
import { deleteChar, deleteSelection, type EditorSchema, insertLineBreak, splitBlock, unitsFor } from "./commands";
import type { EditorCommand, EditorPlugin } from "./plugin";
import type { EditorState, Transaction } from "./state";
import { addRow, cellAt, tableAt } from "./table";
import { wordStep } from "./units";

/**
 * Deletes back to the start of the word (`dir` -1, Ctrl/⌥+Backspace) or on to its end (1); with a
 * selection, the selection.
 * @beta
 */
export const deleteWord =
  (dir: 1 | -1): EditorCommand =>
  (state: EditorState, schema: EditorSchema): Transaction | null => {
    if (!state.empty) return deleteSelection(state, schema);
    const head = state.selection.head;
    const to = wordStep(unitsFor(state, schema), state.text, head, dir);
    if (to === head) return null;
    return deleteSelection(state.select({ anchor: head, head: to }), schema);
  };

/** Where a cell's text is: inside its brackets. */
const inner = (text: string, cell: { from: number; to: number }) =>
  text[cell.from] === "[" && text[cell.to - 1] === "]"
    ? { from: cell.from + 1, to: cell.to - 1 }
    : { from: cell.from, to: cell.to };

/**
 * Tab in a table: the next cell's text selected (Shift+Tab: the previous one), as word processors
 * do; from the last cell, a new row. `null` outside a table.
 * @beta
 */
export const moveCell =
  (dir: 1 | -1): EditorCommand =>
  (state: EditorState, schema: EditorSchema): Transaction | null => {
    const table = tableAt(state, state.selection.head, schema);
    if (!table) return null;
    const at = cellAt(table, state.selection.head);
    if (!at) return null;
    const flat = table.ranges.flat();
    const index = table.ranges.slice(0, at.row).reduce((n, r) => n + r.length, 0) + at.column;
    const next = flat[index + dir];
    if (!next) {
      if (dir < 0) return { edits: [], selection: state.selection };
      // Past the last cell: a row below, the caret in its first cell.
      return addRow("below")(state, schema);
    }
    const { from, to } = inner(state.text, next);
    return { edits: [], selection: { anchor: from, head: to } };
  };

/** Commands that always apply: the key is the editor's, whatever it does. */
const swallow: EditorCommand = (state) => ({ edits: [], selection: state.selection });

/**
 * The editor's keys. `Word-` is Ctrl, or ⌥ on Apple platforms, the modifier that moves by words.
 * @beta
 */
export const baseKeymap: Readonly<Record<string, EditorCommand | readonly EditorCommand[]>> = {
  Enter: splitBlock,
  "Shift-Enter": insertLineBreak,
  Backspace: deleteChar(-1),
  "Shift-Backspace": deleteChar(-1),
  Delete: deleteChar(1),
  "Word-Backspace": deleteWord(-1),
  "Word-Delete": deleteWord(1),
  // A list item in or out a level, then a table's cells; elsewhere Tab stays in the editor (the
  // view lets it through after Escape, for keyboard users leaving the editor).
  Tab: [indentItems(1), moveCell(1), swallow],
  "Shift-Tab": [indentItems(-1), moveCell(-1), swallow],
};

/** The editor's keys as a plugin, below every other (priority -100); every editor has it. @beta */
export const keysPlugin: EditorPlugin = { key: "keys", priority: -100, keymap: baseKeymap };
