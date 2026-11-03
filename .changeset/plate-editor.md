---
"@typstream/plate": minor
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/dom": minor
"@typstream/react": minor
"typstream": minor
---

New package, `@typstream/plate` (beta): `<TypstPlateEditor value onChange>`, a visual editor for Typst documents on Plate. The document shows as `<Typstream>`'s HTML target lays it out (pages, Typst's fonts and spacing, plugins' components) and is edited in place: typing, deleting, Enter, marks, headings and lists become edits of the Typst source, which compiles again. A fixed toolbar and a floating one over a selection; undo and redo over the source.

What it needs from the other packages, all beta:

- `@typstream/core`, `@typstream/engine`: `CompileParams.spans` and `DocumentOptions.spans`. HTML compiles mark where the document's text came from (`<typstream-text data-src="from to">` around each text, `data-typstream-span` on elements from its markup), in the document's offsets; engine-wasm's `compile_html(spans)` writes them.
- `@typstream/dom`: `HtmlRendererOptions.onParse`, called with each piece of markup before it is sanitized.
- `@typstream/react`: `useTypstreamDefaults()` and `useTypstreamEngine(engine?)`, for components that open documents themselves.
- `typstream`: `typstFonts`, the engine's fonts `<Typstream>` registers for the HTML target.
