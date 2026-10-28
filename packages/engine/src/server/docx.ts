// DOCX exports (#131): the server compiles pages into a document model (the adapter's `exportDocxModel`, engine-wasm's
// `compile_docx_model`) and `@typstream/docx` writes the file.

/**
 * Typst source appended to a document before a DOCX export: laid-out pages don't keep their margins, and Word needs
 * them, so it records `page.margin` where the document ends, inside every template's show rule. engine-wasm's
 * `Engine.docx_margin_probe()` is the same text (a test checks it).
 * @public
 */
export const DOCX_MARGIN_PROBE: string = "\n#context [#metadata(page.margin) <typstream-docx-margin>]\n";
