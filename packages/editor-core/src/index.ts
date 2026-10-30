// @typstream/editor-core (#36): a Typst document edited on its own pages. The view puts a caret,
// a selection and the keyboard on the pages the engine lays out; commands turn what the teacher
// does into minimal edits of the source; plugins add toolbars, menus and components.

export { type Alignment, alignmentAt, type BlockType, blockType, indentItems, setAlignment, setBlockType, toggleList } from "./blocks";
export {
  canType,
  DEFAULT_SCHEMA,
  deleteChar,
  deleteSelection,
  type EditorSchema,
  insertLineBreak,
  insertText,
  moveChar,
  snap,
  splitBlock,
} from "./commands";
export {
  argumentOf,
  type Component,
  CURSOR,
  componentAt,
  componentIn,
  componentsAt,
  componentsIn,
  insertBlock,
  insertInline,
  setArgument,
} from "./components";
export { History } from "./history";
export { type CaretBox, type Glyph, type LaidElement, Layout, type Line, type PageRect } from "./layout";
export { isMarked, type Mark, markValue, setMark, toggleMark } from "./marks";
export {
  basicPlugins,
  blocksPlugin,
  COLORS,
  type ComponentSpec,
  createEditorPlugin,
  type EditorCommand,
  type EditorPlugin,
  fromTypstreamPlugin,
  HIGHLIGHTS,
  type InputRule,
  type InsertItem,
  insertPlugin,
  marksPlugin,
  schemaOf,
  type ToolbarItem,
} from "./plugin";
export { EditorState, mapSelection, mapThrough, type Selection, type Transaction } from "./state";
export {
  addColumn,
  addRow,
  cellAt,
  deleteColumn,
  deleteRow,
  deleteTable,
  type TableModel,
  tableAt,
  tableTemplate,
} from "./table";
export { escapeMarkup, readString, typstString } from "./text";
export { type Unit, unitsOf } from "./units";
export { createEditor, type EditorOptions, type EditorView } from "./view";
