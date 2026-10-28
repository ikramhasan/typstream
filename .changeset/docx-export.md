---
"@typstream/core": minor
"@typstream/docx": minor
"@typstream/engine": minor
"@typstream/engine-wasm": minor
"@typstream/dom": minor
"@typstream/react": minor
"@typstream/node": minor
---

DOCX export (beta, #131): `exportDocx()` on `EngineDocument`, `MountedTypstream`, `<Typstream>`'s handle and
`useTypstream()`, and `render(source, "docx")` in `@typstream/node`, give an editable Word file that lays out as the
PDF does: paragraphs and runs, headings, lists with Word numbering, tables and grids with Typst's column widths,
framed boxes, headers and footers with page-number fields, Typst's fonts embedded, under the layout profile.
engine-wasm reads the laid-out pages into a document model (`compile_docx_model`, `docx_margin_probe`); the new
`@typstream/docx` writes the file, loaded by the engine's worker on the first DOCX export. The protocol's
`ExportFormat` gains `docx` (`export/docx`). Equations, images and drawings hold their place as empty space for now.
`@typstream/node`'s protocol server no longer applies the layout profile twice.
