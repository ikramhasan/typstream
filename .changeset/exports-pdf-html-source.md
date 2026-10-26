---
"@typstream/engine": minor
"@typstream/engine-wasm": minor
"@typstream/dom": minor
"@typstream/node": patch
---

Exports from the same compiled document (#18). `EngineDocument` adds `exportPdf()`, `exportHtml()` and `exportSource()`. Exports run in the preview's worker, ahead of waiting compiles and under the final watchdog budget. They reject with `ExportError` (`reason` plus diagnostics in input coordinates). The engine-wasm adapter offers PDF export, and `AdapterDocument.exportPdf` receives the compile `mode`.

`@typstream/engine-wasm` has PDF in its one build: the `pdf` cargo feature is on by default, and `dist/pdf` / `@typstream/engine-wasm/pdf` are gone. The wasm budget is 6.3 MB brotli. `@typstream/node` now runs the default build.

`@typstream/dom` adds `standaloneHtml(html, options)`. It makes an HTML export a file that opens on its own, with the theme, plugin stylesheets, an optional math font, and a Content-Security-Policy that keeps the document's scripts from running.

`mountTypstream` gains `exportPdf()`, `exportHtml()` (the standalone file) and `exportSource()`. They export at the document's own page size, leaving out a fit-width preview's width.
