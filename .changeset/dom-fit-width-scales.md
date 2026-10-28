---
"@typstream/dom": minor
"@typstream/react": minor
---

The paged `fit-width` layout now shows the document's own pages scaled to the element's width, so the preview is the
PDF's pages (#118); resizing only scales them. Laying the document out again at the element's width is now
`layout: "reflow"`, and its helpers are renamed: `FIT_WIDTH_PREAMBLE` → `REFLOW_PREAMBLE`, `fitWidthInputs` →
`reflowInputs` (`pageHeight` and `resizeDebounce` apply to `reflow`).
