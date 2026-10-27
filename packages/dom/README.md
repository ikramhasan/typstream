# @typstream/dom

Framework-free renderers for typstream's output, and `mountTypstream`, which puts them on an engine document. `@typstream/react` is a thin layer over it.

## `mountTypstream`: a document in an element

What the framework bindings wrap (`@typstream/react` is a thin layer over it). It opens a document on an engine, feeds it, and shows each artifact with the renderer for its target.

```ts
import { createEngine, engineWorker } from "@typstream/engine";
import { mountTypstream } from "@typstream/dom";

const engine = createEngine({ spawn: engineWorker() });
const options = { engine, isStreaming: true, animated: true, caret: true };
const view = mountTypstream(element, { ...options, source: "" });
let text = "";
for await (const chunk of llmStream) view.update({ ...options, source: (text += chunk) });
view.update({ ...options, source: text, isStreaming: false }); // finish: strict compile, no caret
```

- **`update(options)` takes all options each time** and acts only on what changed: a `source` that extends the last one is pushed, any other is set; `isStreaming` turning false finishes the document, turning true starts it over. `stream` (an `AsyncIterable<string>`) is the alternative to `source`. Target, inputs and files change in place; a different engine, preamble (plugins', template's, own), heal or schedule options open a new document, and the old output stays until its first compile.
- **Lazy.** The document opens when the element comes within a screen of the viewport, or as soon as it streams (`lazy: false` opens it right away). Offscreen, finished documents apply changes when they scroll back.
- **Renderers follow the artifact's target**, so after `target` changes the old output stays until the first artifact of the new one.
- `getState()` / `subscribe()` read the document's state, `destroy()` disposes it and removes what was rendered (the engine is the caller's).
- **Callbacks.** `onStatusChange`, `onDiagnostics`, and the telemetry hooks (PLAN §8.6): `onRendered` with each artifact drawn (its compile's report, see `@typstream/engine`'s README, plus `renderMs` and `blocks` or `pages`), `onFallback` and `onWatchdog` with the document's events.

## Render islands (beta)

`islands` on `mountTypstream` and `createHtmlRenderer` maps names to framework-free renderers, `(host, props) => { update, destroy }` (`src/islands.ts`, PLAN §8.4). Each `typstream-island` marker whose name a plugin declares (`islands` facet, with `parse` checking the data) gets a host positioned over its Typst fallback; the host moves into the re-created marker while its block streams, so an island mounts once and receives new props (`isIncomplete` while its block is past heal's stable offset). Markers whose data is too long or doesn't parse, whose renderer throws, or past 50 per document keep their fallback, which print always shows. The paged view's overlay follows the canvas pages (#14). Guide: `apps/website/content/docs/guides/islands.mdx`.

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

- **Only changed pages are redrawn.** Pages are matched by index and redrawn when their hash changes and their SVG with it, so a streamed update usually touches the last page. (Typst's frame hashes include source spans, so an unchanged page can come back under a new hash; it isn't redrawn.) Pages past the new page count are removed.
- **Visible pages first.** Changed pages on screen are drawn at the next frame. Offscreen ones, and every text layer, wait for idle time (`requestIdleCallback`, a timer in WebKit), or are drawn as soon as they scroll into view. `view.flush()` draws everything now, e.g. before printing.
- **One shadow root per page.** typst-svg gives glyph definitions content-hash ids that repeat on every page. Inline in one document, Chromium re-resolves every `<use>` on the page whenever one page changes. Scoped ids avoid that, and keep the app's CSS off the SVG. Pages also have `content-visibility: auto`.
- **Text layer.** The SVG draws glyphs as paths, so invisible HTML text is laid over each page from engine-wasm's text runs, stretched to each run's width. Selection, copy (with line breaks), find-in-page and screen readers use it, and the SVG is `aria-hidden`.
- **Links.** Only `http(s)` and `mailto` links keep their `href`; they open in a new tab (`linkTarget`). Links within the document have no target in a standalone page SVG and stay inert.
- **Layouts.** `fixed` (default) shows pages at their authored size, scaled down to fit. `fit-width` compiles pages as wide as the container through `sys.inputs`, and recompiles after a resize (debounced). Open the document with `FIT_WIDTH_PREAMBLE` in its preamble. A document that sets its own page size keeps it: Typst has no rule that applies after the document. Pages keep A4's proportions by default, so long documents still update page by page. `pageHeight: "auto"` makes one page as tall as the content, for short documents.

`createPagedView(container, options)` is the renderer without the document: call `view.render(artifact)` with any `PagedArtifact`, complete or changed pages only.

Styles are added once per document as a constructed stylesheet, and the text layer's positions are set through the CSSOM, so a strict CSP doesn't need `'unsafe-inline'` for styles (nor does the HTML renderer, which applies Typst's inline styles through the CSSOM; the [security guide](../../apps/website/content/docs/guides/security.mdx) has the whole policy). Classes for theming: `.typstream-paged` (with `data-layout`), `.typstream-page` (with `data-page`, 1-based), `.typstream-text-layer`.

## Tests

- `pnpm test`: the pure parts (link policy, text-layer layout, fit-width inputs) in Node.
- `pnpm test:browser`: the renderer against the real engine worker in Chromium, Firefox and WebKit (vitest browser mode, Playwright). `BROWSERS=chromium` runs one. The streaming test prints draw times and Chromium's long tasks.
- `VITE_RESEARCH=1 pnpm test:browser research`: the #14 measurements (glyph defs, text-layer options, where a page swap's time goes).
- `pnpm size`: the paged renderer ≤ 4 KB gzipped.
