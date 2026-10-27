---
"@typstream/react": minor
"typstream": minor
"@typstream/dom": minor
---

Exports from the React component (#18). `TypstreamHandle` and `useTypstream()` add `exportPdf(options?)`, `exportHtml(options?)` and `exportSource()`, forwarded to the component's `mountTypstream`: a `layout="fit-width"` preview prints at the document's own page size, with the template's inputs and the `inputs` prop, and a lazy document that hasn't opened yet opens to export. `exportHtml` returns a standalone file with the component's plugins, stylesheets and theme. Without a mounted component they reject (`exportSource()` throws). `StandaloneHtmlOptions` and `TypstreamExportOptions` are re-exported.

`mountTypstream`'s `exportPdf()` and `exportHtml()` take `{ inputs }` (`TypstreamExportOptions`): `sys.inputs` for that export only, over the template's and the mount's `inputs`, e.g. a teacher's copy (`{ showAnswers: "true" }`) of a preview showing the student's.
