// @typstream/docx: a laid-out Typst document as an editable DOCX that Word-like engines lay out as Typst did
// (#118, #131). engine-wasm reads the pages into a model (`compile_docx_model`); this writes the OOXML.

export type {
  DocxBlock,
  DocxBlockBase,
  DocxBreakRun,
  DocxCell,
  DocxColumns,
  DocxDrawing,
  DocxFont,
  DocxGapRun,
  DocxList,
  DocxModel,
  DocxParagraph,
  DocxRow,
  DocxRule,
  DocxRun,
  DocxSection,
  DocxTable,
  DocxTabRun,
  DocxTextRun,
} from "./model";
export { writeDocx } from "./write";
