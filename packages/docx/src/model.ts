// The document model engine-wasm's `compile_docx_model` emits (src/docx.rs): what Typst laid out, in points, for the
// writer to turn into OOXML under the layout profile (#129).

/** A laid-out document as a DOCX export needs it: sections, the fonts runs name, lists' numbering. @internal */
export interface DocxModel {
  /** Sections: a page size and margins, and what flows on those pages. */
  sections: DocxSection[];
  /** Faces runs use, by index: their data comes with the model, in the same order. */
  fonts: DocxFont[];
  /** List numberings, by `DocxParagraph.list.id`. */
  lists: DocxList[];
}

/** Pages of one size and margins, and the blocks on them. @internal */
export interface DocxSection {
  /** Page width in points. */
  width: number;
  /** Page height in points. */
  height: number;
  /** Page margins in points. */
  margin: { top: number; right: number; bottom: number; left: number };
  /** The body's blocks, in order. */
  blocks: DocxBlock[];
  /** The header on every page (after the first, when `headerFirst` is set). */
  header?: DocxBlock[];
  /** The first page's header, when it differs. */
  headerFirst?: DocxBlock[];
  /** The footer on every page (after the first, when `footerFirst` is set). */
  footer?: DocxBlock[];
  /** The first page's footer, when it differs. */
  footerFirst?: DocxBlock[];
  /** Distance from the page's top edge to the header's text. */
  headerDistance?: number;
  /** Distance from the page's bottom edge to the footer's text. */
  footerDistance?: number;
}

/** A face as Word names it. @internal */
export interface DocxFont {
  /** Legacy family name (name ID 1): what runs name and embedded fonts are filed under. */
  name: string;
  /** The face is the family's bold one. */
  bold: boolean;
  /** The face is the family's italic one. */
  italic: boolean;
  /** Advance of the no-break space, in em: exact-width gaps are made of it. */
  nbsp: number;
}

/** A list's numbering. @internal */
export interface DocxList {
  /** Word's number format (`decimal`, `lowerLetter`, `upperRoman`, `bullet`, …), or `none` for literal labels. */
  format: string;
  /** Level text: `%1.` for "1.", the bullet itself for a bullet list. */
  text: string;
  /** The first item's number. */
  start: number;
  /** `end` when labels are right-aligned (numbers of different widths), else `start`. */
  align: "start" | "end";
  /** Where labels start, from the left of the area the list is in. */
  labelLeft: number;
  /** Where labels end. */
  labelRight: number;
  /** Where item bodies start. */
  bodyLeft: number;
}

/** A block in a flow: a paragraph, a table, a rule or a placeholder. @internal */
export type DocxBlock = DocxParagraph | DocxTable | DocxRule | DocxDrawing | DocxColumns;

/** Fields every block has. @internal */
export interface DocxBlockBase {
  /** Space before it, in points: how far below the previous block Typst put it. */
  before?: number;
  /** A page break before it (Typst's `pagebreak()`). */
  pageBreak?: boolean;
}

/** A paragraph. @internal */
export interface DocxParagraph extends DocxBlockBase {
  type: "p";
  align: "start" | "center" | "end";
  /**
   * Indents in points: `left` from the area's left; `firstLine` is the first line's offset from it (negative: hanging);
   * `right` from the area's right (a padded block quote).
   */
  indent: { left: number; firstLine: number; right?: number };
  /** Line pitch in points: exact, or at least that with `atLeast` (lines with math or boxes). */
  pitch: number;
  atLeast?: boolean;
  /** How many lines Typst set it on. */
  lines: number;
  /** A heading's level. */
  heading?: number;
  /** Tab stops, from the area's left: a tab run moves to the next. */
  tabs?: { pos: number; align: "start" | "end" }[];
  /** A list item's first paragraph: its list and its label. */
  list?: { id: number; label: string };
  runs: DocxRun[];
}

/** A run of text, an exact-width gap, a tab or a line break. @internal */
export type DocxRun = DocxTextRun | DocxGapRun | DocxBreakRun | DocxTabRun;

/** A tab to the paragraph's next tab stop (what `h(1fr)` before a line's last words is). @internal */
export interface DocxTabRun {
  tab: true;
}

/** A line break Typst was told to make (`\`). @internal */
export interface DocxBreakRun {
  break: true;
}

/** Text in one face, size and colour. @internal */
export interface DocxTextRun {
  text: string;
  /** Index into `DocxModel.fonts`. */
  font: number;
  /** Size in points. */
  size: number;
  /** Hex RGB, black when absent. */
  color?: string;
  underline?: boolean;
  /** A URL the run links to. */
  link?: string;
  /** A page number: `PAGE` or `NUMPAGES`. */
  field?: "PAGE" | "NUMPAGES";
}

/** An exact-width space: a gap in a line (`h()`), a blank's line, a placeholder (math, images). @internal */
export interface DocxGapRun {
  /** Width in points. */
  gap: number;
  font: number;
  size: number;
  underline?: boolean;
  /** Room held for an equation or image (#132, #133), not a gap Typst made. */
  placeholder?: boolean;
}

/** A table, or anything drawn as one (a grid, a framed block). @internal */
export interface DocxTable extends DocxBlockBase {
  type: "table";
  /** From the area's left. */
  indent: number;
  /** Column widths in points. */
  columns: number[];
  rows: DocxRow[];
}

/** A table row. @internal */
export interface DocxRow {
  /** The row stays on one page. */
  cantSplit: boolean;
  /** Repeated on every page the table runs over. */
  header?: boolean;
  cells: DocxCell[];
}

/** A table cell. @internal */
export interface DocxCell {
  /** The column it starts in. */
  col: number;
  /** Columns it spans. */
  span?: number;
  /** Rows it spans. */
  rowSpan?: number;
  /**
   * Cell margins in points. Above and below they are where Typst put the content in the row, so content and margins
   * make the row's height: engines read a row height of "at least" with or without the margins.
   */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Borders: width in points and hex colour, per side drawn. */
  borders: Partial<Record<"top" | "right" | "bottom" | "left", { width: number; color: string }>>;
  /** Hex fill. */
  fill?: string;
  valign?: "center" | "bottom";
  blocks: DocxBlock[];
}

/** A horizontal rule across the area (`line(length: 100%)`). @internal */
export interface DocxRule extends DocxBlockBase {
  type: "rule";
  thickness: number;
  color: string;
  indent: { left: number; right: number };
}

/** Space held for what the export can't write yet (equations, images, drawings), as big as Typst drew it. @internal */
export interface DocxDrawing extends DocxBlockBase {
  type: "drawing";
  width: number;
  height: number;
  indent: number;
  math?: boolean;
  /** Room held for an equation, image or drawing (#132, #133); without it, space an empty block takes. */
  placeholder?: boolean;
}

/**
 * Typst's `columns`: each column's blocks, side by side across the text width, `gap` points apart. Word lays them out
 * in a section of their own, with a column break between them. @internal
 */
export interface DocxColumns extends DocxBlockBase {
  type: "columns";
  gap: number;
  columns: DocxBlock[][];
}
