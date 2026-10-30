// Tables: `#table(columns: …, [a], [b], …)` read as rows and columns, so the editor can add and
// remove them with buttons. A change rewrites the table's arguments, each cell's source kept as it
// is, one row to a line. Cells spanning several columns or rows aren't supported by these
// commands (they return `null`); the cells' text is edited on the page like any other.

import type { SyntaxNode } from "@typstream/syntax";
import { componentAt } from "./components";
import { DEFAULT_SCHEMA, type EditorSchema } from "./commands";
import type { EditorState, Transaction } from "./state";
import { calleeName, callArgs } from "./tree";

const TABLES = new Set(["table", "grid"]);

/**
 * A table as rows and columns: `cells[row][column]` are the cells' Typst source (`[a]`). `header`
 * says whether the first row is a `table.header(…)`.
 * @beta
 */
export interface TableModel {
  /** `table` or `grid`. */
  name: string;
  /** Start of the table's `#`. */
  from: number;
  /** End of the call. */
  to: number;
  /** How many columns. */
  columns: number;
  /** The `columns:` argument's source, if it lists the columns' sizes (`(1fr, auto)`): their sources. */
  sizes: string[] | null;
  /** Rows of cells' source. */
  cells: string[][];
  /** Ranges of the cells in the source, by row and column. */
  ranges: { from: number; to: number }[][];
  /** The first row is the header. */
  header: boolean;
  /** The other named arguments' source, in order (`stroke: none`), without `columns`. */
  named: [string, string][];
}

/** Reads the table (or grid) the caret is in. `null` when there is none, or it spans cells. @beta */
export const tableAt = (state: EditorState, offset = state.from, schema: EditorSchema = DEFAULT_SCHEMA): TableModel | null => {
  const component = componentAt(state, offset, schema, TABLES);
  if (!component) return null;
  return readTable(state, component.call, component.from);
};

const readTable = (state: EditorState, call: SyntaxNode, from: number): TableModel | null => {
  const text = state.text;
  const args = callArgs(call, text);
  const name = calleeName(call, text);
  if (!args || !name) return null;
  const src = (n: SyntaxNode) => text.slice(n.from, n.to);
  let columns = 1;
  let sizes: string[] | null = null;
  const columnsArg = args.named.get("columns");
  if (columnsArg) {
    if (columnsArg.kind === "Int") columns = Number(src(columnsArg));
    else if (columnsArg.kind === "Array") {
      sizes = columnsArg.children.filter((c) => !["LeftParen", "RightParen", "Comma", "Space"].includes(c.kind)).map(src);
      columns = sizes.length;
    } else return null;
  }
  const named = [...args.namedNodes].filter(([k]) => k !== "columns").map(([k]) => [k, src(args.named.get(k) as SyntaxNode)] as [string, string]);
  const flat: SyntaxNode[] = [];
  let header = false;
  let headerCells: SyntaxNode[] = [];
  for (const p of args.positional) {
    if (p.kind === "FuncCall") {
      const callee = calleeName(p, text);
      if (callee === `${name}.header` && flat.length === 0 && !header) {
        const inner = callArgs(p, text);
        if (!inner || inner.named.size) return null;
        headerCells = inner.positional;
        header = true;
        continue;
      }
      // A cell with its own arguments: only without spans.
      if (callee === `${name}.cell`) {
        const inner = callArgs(p, text);
        if (inner?.named.has("colspan") || inner?.named.has("rowspan")) return null;
      } else if (callee?.startsWith(`${name}.`)) return null;
    }
    flat.push(p);
  }
  for (const t of args.trailing) flat.push(t);
  if (header && headerCells.length !== columns) return null;
  const cells: string[][] = [];
  const ranges: { from: number; to: number }[][] = [];
  if (header) {
    cells.push(headerCells.map(src));
    ranges.push(headerCells.map((c) => ({ from: c.from, to: c.to })));
  }
  for (let i = 0; i < flat.length; i += columns) {
    const row = flat.slice(i, i + columns);
    cells.push(row.map(src));
    ranges.push(row.map((c) => ({ from: c.from, to: c.to })));
  }
  // A short last row is filled with empty cells when the table is rewritten.
  const last = cells[cells.length - 1];
  if (last) while (last.length < columns) last.push("[]");
  return { name, from, to: call.to, columns, sizes, cells, ranges, header, named };
};

/** The row and column of the cell holding `offset`, or `null`. @beta */
export const cellAt = (table: TableModel, offset: number): { row: number; column: number } | null => {
  for (let row = 0; row < table.ranges.length; row++) {
    const r = table.ranges[row] as { from: number; to: number }[];
    for (let column = 0; column < r.length; column++) {
      const c = r[column] as { from: number; to: number };
      if (c.from <= offset && offset <= c.to) return { row, column };
    }
  }
  return null;
};

/** Typst for `table`: its call with every row on a line, `#` included. */
export const writeTable = (table: TableModel): string => {
  const columns = table.sizes ? `(${table.sizes.join(", ")})` : String(table.columns);
  const named = [`columns: ${columns}`, ...table.named.map(([k, v]) => `${k}: ${v}`)];
  const rows = table.cells.map((row, i) =>
    i === 0 && table.header ? `${table.name}.header(${row.join(", ")}),` : `${row.join(", ")},`,
  );
  return `#${table.name}(\n  ${named.join(",\n  ")},\n  ${rows.join("\n  ")}\n)`;
};

/** A table of `rows` × `columns` empty cells, the first row a header, as a template with the caret in the first cell. @beta */
export const tableTemplate = (rows: number, columns: number): string => {
  const header = Array.from({ length: columns }, (_, i) => (i === 0 ? "[{{cursor}}]" : "[]")).join(", ");
  const body = Array.from({ length: Math.max(0, rows - 1) }, () => `  ${Array(columns).fill("[]").join(", ")},`);
  return `#table(\n  columns: ${columns},\n  table.header(${header}),\n${body.join("\n")}\n)`;
};

/** Replaces the table by `next`, the caret in cell (`row`, `column`). */
const rewrite = (state: EditorState, table: TableModel, next: TableModel, row: number, column: number): Transaction => {
  // Its other lines take the indentation of the line it starts on.
  const lineStart = state.text.lastIndexOf("\n", table.from - 1) + 1;
  const indent = /^[ \t]*/.exec(state.text.slice(lineStart, table.from))?.[0] ?? "";
  const insert = writeTable(next).replace(/\n/g, `\n${indent}`);
  const edits = [{ from: table.from, to: table.to, insert }];
  // The caret goes into the cell, just inside its `[`.
  const after = state.apply({ edits }).state;
  const cell = tableAt(after, table.from + 1)?.ranges[row]?.[column];
  const at = cell ? cell.from + 1 : table.from;
  return { edits, selection: { anchor: at, head: at } };
};

const clone = (t: TableModel): TableModel => ({ ...t, cells: t.cells.map((r) => [...r]), sizes: t.sizes ? [...t.sizes] : null });

/**
 * Adds a row above or below the caret's row (a header gets its row below it).
 * @beta
 */
export const addRow =
  (where: "above" | "below") =>
  (state: EditorState, schema?: EditorSchema): Transaction | null => {
    const table = tableAt(state, state.from, schema);
    if (!table) return null;
    const cell = cellAt(table, state.from) ?? { row: table.cells.length - 1, column: 0 };
    const next = clone(table);
    let row = where === "above" ? cell.row : cell.row + 1;
    if (table.header && row === 0) row = 1;
    next.cells.splice(row, 0, Array(table.columns).fill("[]"));
    return rewrite(state, table, next, row, cell.column);
  };

/**
 * Adds a column left or right of the caret's column: `columns` grows (a sizes list gets the
 * neighbour's size), and every row an empty cell.
 * @beta
 */
export const addColumn =
  (where: "left" | "right") =>
  (state: EditorState, schema?: EditorSchema): Transaction | null => {
    const table = tableAt(state, state.from, schema);
    if (!table) return null;
    const cell = cellAt(table, state.from) ?? { row: 0, column: table.columns - 1 };
    const column = where === "left" ? cell.column : cell.column + 1;
    const next = clone(table);
    next.columns++;
    if (next.sizes) next.sizes.splice(column, 0, next.sizes[cell.column] ?? "auto");
    for (const row of next.cells) row.splice(column, 0, "[]");
    return rewrite(state, table, next, cell.row, column);
  };

/** Deletes the caret's row; the last row deletes the table. @beta */
export const deleteRow = (state: EditorState, schema?: EditorSchema): Transaction | null => {
  const table = tableAt(state, state.from, schema);
  if (!table) return null;
  const cell = cellAt(table, state.from);
  if (!cell) return null;
  if (table.cells.length <= 1) return deleteTable(state, schema);
  const next = clone(table);
  next.cells.splice(cell.row, 1);
  if (table.header && cell.row === 0) next.header = false;
  return rewrite(state, table, next, Math.min(cell.row, next.cells.length - 1), cell.column);
};

/** Deletes the caret's column; the last column deletes the table. @beta */
export const deleteColumn = (state: EditorState, schema?: EditorSchema): Transaction | null => {
  const table = tableAt(state, state.from, schema);
  if (!table) return null;
  const cell = cellAt(table, state.from);
  if (!cell) return null;
  if (table.columns <= 1) return deleteTable(state, schema);
  const next = clone(table);
  next.columns--;
  next.sizes?.splice(cell.column, 1);
  for (const row of next.cells) row.splice(cell.column, 1);
  return rewrite(state, table, next, cell.row, Math.min(cell.column, next.columns - 1));
};

/** Deletes the table the caret is in, and the blank line it leaves. @beta */
export const deleteTable = (state: EditorState, schema?: EditorSchema): Transaction | null => {
  const table = tableAt(state, state.from, schema);
  if (!table) return null;
  let to = table.to;
  const after = /^[ \t]*\n?/.exec(state.text.slice(to));
  if (after) to += after[0].length;
  return { edits: [{ from: table.from, to, insert: "" }], selection: { anchor: table.from, head: table.from } };
};

