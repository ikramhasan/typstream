// @typstream/editor-core: the visual editor's model (#36). A Typst document as a Plate (Slate)
// value derived from Typst's own syntax tree, and back as minimal text edits. Framework-free:
// Plate values are plain JSON, so nothing here imports Slate or React.

export { type SerializeOptions, TypstDocument, type TypstDocumentOptions } from "./document";
export { normalizeInlines } from "./parse";
export { serializeBlock, serializeInlines, serializeValue } from "./serialize";
export type * from "./types";
