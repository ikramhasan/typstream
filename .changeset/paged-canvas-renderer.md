---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/engine-wasm": minor
"@typstream/dom": minor
"@typstream/react": minor
---

The paged target paints pages on canvases (#14). A streamed update to a dense page costs about a millisecond on the main thread in Chromium and Safari, and 10–15 ms in Firefox; as SVG in the DOM (one element per glyph) it took 12–31 ms.

- **engine-wasm:** `compile_svg_changed(true)` sends pages as drawings (`ChangedPage.drawing`): glyph outlines keyed by font and glyph, the page's operations as 32-bit floats, its strings and its links, with `svg` empty. A drawing is about a third of the SVG's size and exports three times faster. Pages with gradients, tilings or colour glyphs still come as SVG.
- **Protocol:** `CompileParams.pageFormat` (`"svg"`, the default, or `"drawing"`) and `PageUpdate.drawing` (`PageDrawing`, `@beta`). Changing the format sends every page.
- **engine:** `engine.open({ pageFormat })` and `EngineDocument.setPageFormat()`.
- **dom:** `mountPaged` and `mountTypstream` ask for drawings and paint them, with a `renderer` option (`"canvas"`, the default, or `"svg"`). Canvases follow the device pixel ratio and pinch zoom, and only pages near the viewport keep their pixels. Every page is painted before printing. Links become `<a>` elements over the canvas, filtered as before. The text layer is unchanged. `createPagedView` paints any page that comes as a drawing and puts the others in shadow roots as before.
- **react:** `renderer` prop and provider default.
