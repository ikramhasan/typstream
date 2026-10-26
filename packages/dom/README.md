# @typstream/dom

Framework-free renderers for typstream's output. `@typstream/react` is a thin layer over them.

## Paged (SVG pages)

```ts
import { createEngine, engineWorker } from "@typstream/engine";
import { mountPaged } from "@typstream/dom";

const engine = createEngine({ spawn: engineWorker() });
const doc = engine.open({ target: "paged" });
const { destroy } = mountPaged(document.querySelector("#preview")!, doc);

for await (const chunk of llmStream) doc.push(chunk);
doc.finish();
```

- **Only changed pages are redrawn.** Pages are matched by index and redrawn when their hash changes, so a streamed update usually touches the last page. Pages past the new page count are removed.
- **Visible pages first.** Changed pages on screen are drawn at the next frame. Offscreen ones, and every text layer, wait for idle time (`requestIdleCallback`, a timer in WebKit), or are drawn as soon as they scroll into view. `view.flush()` draws everything now, e.g. before printing.
- **One shadow root per page.** typst-svg gives glyph definitions content-hash ids that repeat on every page. Inline in one document, Chromium re-resolves every `<use>` on the page whenever one page changes. Scoped ids avoid that, and keep the app's CSS off the SVG. Pages also have `content-visibility: auto`.
- **Text layer.** The SVG draws glyphs as paths, so invisible HTML text is laid over each page from engine-wasm's text runs, stretched to each run's width. Selection, copy (with line breaks), find-in-page and screen readers use it, and the SVG is `aria-hidden`.
- **Links.** Only `http(s)` and `mailto` links keep their `href`; they open in a new tab (`linkTarget`). Links within the document have no target in a standalone page SVG and stay inert.
- **Layouts.** `fixed` (default) shows pages at their authored size, scaled down to fit. `fit-width` compiles pages as wide as the container through `sys.inputs`, and recompiles after a resize (debounced). Open the document with `FIT_WIDTH_PREAMBLE` in its preamble. A document that sets its own page size keeps it: Typst has no rule that applies after the document. Pages keep A4's proportions by default, so long documents still update page by page. `pageHeight: "auto"` makes one page as tall as the content, for short documents.

`createPagedView(container, options)` is the renderer without the document: call `view.render(artifact)` with any `PagedArtifact`, complete or changed pages only.

Styles are added once per document as a constructed stylesheet, and the text layer's positions are set through the CSSOM, so a strict CSP doesn't need `'unsafe-inline'` for styles. Classes for theming: `.typstream-paged` (with `data-layout`), `.typstream-page` (with `data-page`, 1-based), `.typstream-text-layer`.

## Tests

- `pnpm test`: the pure parts (link policy, text-layer layout, fit-width inputs) in Node.
- `pnpm test:browser`: the renderer against the real engine worker in Chromium, Firefox and WebKit (vitest browser mode, Playwright). `BROWSERS=chromium` runs one. The streaming test prints draw times and Chromium's long tasks.
- `VITE_RESEARCH=1 pnpm test:browser research`: the #14 measurements (glyph defs, text-layer options, where a page swap's time goes).
- `pnpm size`: the paged renderer ≤ 4 KB gzipped.
