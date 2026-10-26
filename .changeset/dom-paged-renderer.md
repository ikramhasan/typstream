---
"@typstream/dom": minor
"@typstream/core": minor
"@typstream/engine-wasm": minor
---

The paged renderer (#14). `@typstream/dom` is new: `mountPaged(container, doc)` shows an engine document as SVG pages and keeps them in step, redrawing only pages whose hash changed (visible ones at the next frame, the rest in idle time), with a selectable, searchable text layer, sanitized links, and `fixed` or `fit-width` layouts (`FIT_WIDTH_PREAMBLE`). `createPagedView` is the same renderer without the document. engine-wasm now returns each changed page's text runs (`ChangedPage.text`), and core's `PageUpdate` has an optional `text: TextRun[]`.
