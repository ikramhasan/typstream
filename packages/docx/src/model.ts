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
  /** Pictures drawings and runs refer to (#133), by index: their SVG and PNG come with the model, in the same order. */
  pictures?: DocxPicture[];
}

/**
 * A picture of what the model can't express otherwise (#133): an image, a CeTZ canvas, a mind map, a box with rounded
 * corners. Its size, and where Typst drew it (page index and top left, in points). @internal
 */
export interface DocxPicture {
  /** Width in points. */
  width: number;
  /** Height in points. */
  height: number;
  /** The page Typst drew it on, from 0. */
  page: number;
  /** Its left edge on the page, in points. */
  x: number;
  /** Its top edge on the page, in points. */
  y: number;
  /** Its description: an image's `alt`, an edu drawing's. */
  alt?: string;
}

/** A picture's SVG, which Word draws, and the PNG older Word and other apps draw instead. @internal */
export interface DocxPictureData {
  /** The picture as SVG. */
  svg: string;
  /** The picture as PNG. */
  png: Uint8Array;
}

/** Pages of one size and margins, and the blocks on them. @internal */
export interface DocxSection {
  /** Page width in points. */
  width: number;
  /** Page height in points. */
  height: number;
  /** Page margins in points. */
  margin: { top: number; right: number; bottom: number; left: number };
  /** How its first pages are numbered, when not from 1 in digits. */
  pageNumbering?: DocxPageNumbering;
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

/** A block in a flow: a paragraph, a table, a rule, a drawing or columns. @internal */
export type DocxBlock = DocxParagraph | DocxTable | DocxRule | DocxDrawing | DocxColumns;

/** Fields every block has. @internal */
export interface DocxBlockBase {
  /** Space before it, in points: how far below the previous block Typst put it. */
  before?: number;
  /** A page break before it (Typst's `pagebreak()`). */
  pageBreak?: boolean;
  /** Typst's page numbering changes here: a section starts on a new page, numbered as this says. */
  pageNumbering?: DocxPageNumbering;
}

/** How a section's pages are numbered: Word's format and, when it starts again, the first number. @internal */
export interface DocxPageNumbering {
  format: "decimal" | "lowerRoman" | "upperRoman" | "lowerLetter" | "upperLetter";
  start?: number;
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
  /** How far the next line's first word missed a line Typst broke, at its narrowest: more room would set it there. */
  fit?: number;
  /**
   * Placed out of the flow (Typst's `place`): a frame at this position on the page, in points from its top left
   * corner, which takes no room.
   */
  frame?: { x: number; y: number; width: number; height: number };
  /** A heading's level. */
  heading?: number;
  /** Tab stops, from the area's left: a tab run moves to the next, filled with `leader` (an outline's dots). */
  tabs?: { pos: number; align: "start" | "center" | "end"; leader?: "dot" | "hyphen" | "underscore" | "middleDot" }[];
  /** A list item's first paragraph: its list and its label. */
  list?: { id: number; label: string };
  runs: DocxRun[];
}

/** A run of text, an exact-width gap, a tab, a line break or an equation. @internal */
export type DocxRun = DocxTextRun | DocxGapRun | DocxBreakRun | DocxTabRun | DocxMathRun;

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
  /** Typst's `super` or `sub`, set with the font's own glyphs: Word's superscript or subscript. */
  script?: "superscript" | "subscript";
}

/** An exact-width space: a gap in a line (`h()`), a blank's line, or a picture in the line. @internal */
export interface DocxGapRun {
  /** Width in points. */
  gap: number;
  font: number;
  size: number;
  underline?: boolean;
  /**
   * A picture in the line, as wide as the gap (#133): its index in `DocxModel.pictures`, and where its top is below
   * the baseline (negative above it). A gap stays when the model has no picture data for it.
   */
  picture?: { index: number; y: number };
}

/**
 * An equation as Word math (OMML, #132), from Typst's own math (engine-wasm's `src/math.rs`). Inline in a line, or
 * `display`: a paragraph's only run, which Word sets on a line of its own. @internal
 */
export interface DocxMathRun {
  math: DocxMath[];
  /** The math font, an index into `DocxModel.fonts`. */
  font: number;
  /** Size in points. */
  size: number;
  /** Hex RGB, black when absent. */
  color?: string;
  display?: boolean;
}

/** A piece of an equation, shaped after the OMML element it becomes. @internal */
export type DocxMath =
  | DocxMathText
  | DocxMathFraction
  | DocxMathScripts
  | DocxMathNary
  | DocxMathFunction
  | DocxMathLimit
  | DocxMathRoot
  | DocxMathDelimiters
  | DocxMathMatrix
  | DocxMathAccent
  | DocxMathBar
  | DocxMathGroupChar
  | DocxMathBox;

/** Math text (`m:r`). @internal */
export interface DocxMathText {
  t: "r";
  text: string;
  /** Word's style: plain (upright), bold, italic, bold italic. Without it, Word sets letters in italic. */
  sty?: "p" | "b" | "i" | "bi";
  /** Word's math alphabet. */
  scr?: "script" | "fraktur" | "double-struck" | "sans-serif" | "monospace";
  /** Text in math (Typst's quoted text): Word's normal text. */
  nor?: boolean;
}

/** A fraction (`m:f`): stacked, without a bar (a binomial's), or skewed. @internal */
export interface DocxMathFraction {
  t: "f";
  num: DocxMath[];
  den: DocxMath[];
  type?: "noBar" | "skw";
}

/** Scripts on a base (`m:sSub`, `m:sSup`, `m:sSubSup`), or before it (`pre`: `m:sPre`). @internal */
export interface DocxMathScripts {
  t: "s";
  e: DocxMath[];
  sub?: DocxMath[];
  sup?: DocxMath[];
  pre?: boolean;
}

/** A big operator and its operand (`m:nary`): limits under and over it with `limits`, else beside. @internal */
export interface DocxMathNary {
  t: "nary";
  chr: string;
  limits: boolean;
  sub?: DocxMath[];
  sup?: DocxMath[];
  e: DocxMath[];
}

/** An operator's name (`sin`, `lim` and its limit) and its operand (`m:func`). @internal */
export interface DocxMathFunction {
  t: "func";
  name: DocxMath[];
  e: DocxMath[];
}

/** A limit under (`below`, `m:limLow`) or over (`m:limUpp`) a base. @internal */
export interface DocxMathLimit {
  t: "lim";
  below: boolean;
  e: DocxMath[];
  lim: DocxMath[];
}

/** A root (`m:rad`), square without `deg`. @internal */
export interface DocxMathRoot {
  t: "rad";
  e: DocxMath[];
  deg?: DocxMath[];
}

/** Delimiters that grow with what they hold (`m:d`); an empty one is none. @internal */
export interface DocxMathDelimiters {
  t: "d";
  open: string;
  close: string;
  e: DocxMath[];
}

/** A matrix (`m:m`): rows of cells, each column's alignment, and the gap between columns when not Word's. @internal */
export interface DocxMathMatrix {
  t: "m";
  rows: DocxMath[][][];
  align: ("left" | "center" | "right")[];
  gap?: number;
}

/** An accent over a base (`m:acc`), its combining character. @internal */
export interface DocxMathAccent {
  t: "acc";
  chr: string;
  e: DocxMath[];
}

/** A line over (`top`) or under a base (`m:bar`). @internal */
export interface DocxMathBar {
  t: "bar";
  top: boolean;
  e: DocxMath[];
}

/** A brace or bracket stretched over (`top`) or under a base (`m:groupChr`). @internal */
export interface DocxMathGroupChar {
  t: "groupChr";
  chr: string;
  top: boolean;
  e: DocxMath[];
}

/** A cancelled base (`m:borderBox` with its border hidden and a diagonal strike). @internal */
export interface DocxMathBox {
  t: "box";
  strike: "bltr" | "tlbr" | "both";
  e: DocxMath[];
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
  /** Starts a page: the table is split there, a page break between, its header rows repeated. */
  pageBreak?: boolean;
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

/**
 * Room a drawing takes in the flow, as big as Typst drew it (an empty one: room an empty box takes), and its picture
 * (#133): its index in `DocxModel.pictures` and its top left from the room's, which differ where the drawing reaches
 * past its room (half a stroke, a label). @internal
 */
export interface DocxDrawing extends DocxBlockBase {
  type: "drawing";
  width: number;
  height: number;
  indent: number;
  picture?: { index: number; x: number; y: number };
  /**
   * `place`d: anchored to the page where Typst drew it, in a paragraph next to it, taking no room. `host` says which:
   * the paragraph after it unless that is on a later page.
   */
  placed?: boolean;
  host?: "previous" | "next";
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
