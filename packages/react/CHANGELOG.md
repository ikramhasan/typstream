# @typstream/react

## 0.1.0

### Minor Changes

- ba56f2e: DOCX export (beta, #131): `exportDocx()` on `EngineDocument`, `MountedTypstream`, `<Typstream>`'s handle and
  `useTypstream()`, and `render(source, "docx")` in `@typstream/node`, give an editable Word file that lays out as the
  PDF does: paragraphs and runs, headings, lists with Word numbering, tables and grids with Typst's column widths,
  framed boxes, columns (Word sections), placed text (frames at its page position), header rows Typst repeats, page
  breaks where Typst starts a page, headers and footers with page-number fields, Typst's fonts embedded, under the
  layout profile.
  engine-wasm reads the laid-out pages into a document model (`compile_docx_model`, `docx_margin_probe`); the new
  `@typstream/docx` writes the file, loaded by the engine's worker on the first DOCX export. The protocol's
  `ExportFormat` gains `docx` (`export/docx`). Equations, images and drawings hold their place as empty space for now.
  `@typstream/node`'s protocol server no longer applies the layout profile twice.
- 8ee7bf4: The paged `fit-width` layout now shows the document's own pages scaled to the element's width, so the preview is the
  PDF's pages (#118); resizing only scales them. Laying the document out again at the element's width is now
  `layout: "reflow"`, and its helpers are renamed: `FIT_WIDTH_PREAMBLE` → `REFLOW_PREAMBLE`, `fitWidthInputs` →
  `reflowInputs` (`pageHeight` and `resizeDebounce` apply to `reflow`).
- ac78eed: Images a document names but has no file for. Such a document used to fail to compile; now the image shows as a placeholder (a box with the file's name) that keeps the call's size and alt text and a figure's caption, while streaming and when finished. The worker stands placeholders in for every image whose path is a string without a file before the first compile (Typst stops at the first image it can't read), and a new `missing-image` fixer (`missingImage` in `@typstream/engine/server`, in `DEFAULT_FIXERS`) handles paths in variables and files whose extension names another format. Finished documents still report the error.
  
  To fill such images in, documents take a `resolveImage(path, { signal })` option (`engine.open`, `mountTypstream`, `<Typstream>` and `<TypstreamProvider>`): the client finds complete `image("…")` paths in the input, asks it once per path for the bytes, and writes them into the document's files. Diagnostics say an image is loading, or why it failed. `fetchImages({ hosts })`, in the new entry point `@typstream/engine/images` and re-exported by `typstream`, downloads `http(s)` URLs from the hosts you allow, without credentials (or through your `proxy`), accepting PNG, JPEG, GIF, WebP and SVG. Nothing is fetched by default, and the engine itself never fetches images. The engine's main-thread budget goes from 8.5 to 9.5 KB gzipped.
  
  In the HTML target, an image shrunk to fit its element or set to a width (`width: 100%`) now keeps its proportions; it used to keep the height Typst gave it and come out stretched.
- 4ad0ae1: Events and telemetry hooks (#30). The library still sends nothing itself; it reports, and the app wires the hooks. Core adds the event shapes (`CompiledEvent`, `RenderedEvent`, `FallbackEvent`, `WatchdogEvent`, `DiagnosticsEvent`, `FallbackLevel`), `CompileResult.fixes` (the errors Layer 3's fixers fixed for the output, as `AppliedFix`) and `CompileFallback.level` (2 stable prefix, 3 error blocks, 4 the whole document). The engine client times healing on the main thread and emits every document's events through `EngineDocument.onEvent` and, as `{ type: "document", event }`, `Engine.onEvent`. `mountTypstream` and `<Typstream>` take `onFallback` and `onWatchdog`, and `onRendered` now receives a `RenderedEvent` (rev, timings, compile and heal ms, patches by reason, fixes, fallback level, render ms, blocks or pages) in place of the `@beta` `RenderedInfo`, which is gone. `TypstreamProvider` takes the telemetry hooks too, and calls them alongside each instance's. `@typstream/node`'s protocol server reports the fallback level.
- 893bbb1: The HTML target looks like the pages. Switching a document between the HTML and paged targets no longer changes how it looks: the same fonts, sizes, line breaks, spacing and page breaks.
  
  - **engine, node**: the layout profile now goes before HTML compiles too, so html-compat reads the same text edges, paragraph and heading spacing and table insets as the pages use. A source anchor goes past the set and show rules its block starts with, and a block of rules only gets none. Under html-compat, the error block of a part that doesn't compile is laid out as on pages. HTML compiles send each glyph outline of Typst's pictures (`html.frame`) once, where it first appears, instead of in every picture. An HTML export can keep the source anchors (`ExportOptions.anchors`, `ExportParams.anchors` in core's protocol), on which html-compat writes the page settings, header and footer, to be laid out as pages.
  - **dom**: the HTML renderer lays the document out on pages (`.typstream-pages`). It uses the page size and margins html-compat writes, scales them as the paged view does (the new `layout` option), and breaks across them where Typst would: orphans and widows, table rows, unbreakable and sticky blocks, forced and weak page breaks. Headers and footers go on every sheet with its page number, footnotes at the foot of their page, and a table's header again on each page it goes on to. Page settings that change mid-document start a page with their numbering, header and footer, `counter(page).update` renumbers the pages, inside and outside margins swap on even pages, and page columns fill one after the other. The page count comes back to the document as the input `typstream-page-count` (the new `onPages` option). Columns fill as Typst's do. Fractional spacing (`v(1fr)`, `h(1fr)`) takes what its page or line leaves, and aligned blocks sit in the room their page leaves. The renderer lays out again when the width changes or fonts load. `registerTypstFonts` (with `TypstFont`, and the `fonts` option of `mountTypstream` and `<Typstream>`) registers Typst's fonts with the profile's line box, so lines are as tall as Typst's and baselines sit where Typst puts them. Blocks that start in the source get `data-typstream-start`. The wide-block scrolling (`data-typstream-wide`) is gone: the pages scale to the element instead. `standalonePages` (with `StandalonePagesOptions`) makes an HTML export a file laid out as the pages, with the Typst fonts it uses embedded; `MountedTypstream.exportHtml()` uses it (`TypstreamHtmlExportOptions`; `pages: false` for the reading layout of `standaloneHtml`), exporting with the anchors and again with the page count it was laid out on (`StandalonePagesOptions.onPages`) until the count holds. The view's own page count feeds back to the document a few times per source and inputs at most, so a document whose length depends on it can't keep the engine compiling. Headers, footers, footnotes and split boxes are clipped to the pages like the rest of the document. Glyph outlines are kept once each in the root (`.typstream-glyphs`), and equation pictures that come again are copied rather than parsed again. A picture Typst sizes 0 tall or wide (a line) is drawn.
  - **html-compat**: it now emits Typst's layout for the HTML target in place of browser defaults:
    - lengths resolved as Typst resolves them, and text sizes on blocks and paragraphs;
    - strokes drawn on the edge, grids and tables placed as Typst places their cells (ARIA roles kept), lists with their marker column;
    - spacing that collapses as Typst's (weak, strong, `v`, attached tight lists, a list after a blank line);
    - first-line indents, aligned text as aligned paragraphs, boxes on their baselines;
    - inline equations broken where Typst breaks them and sitting in their lines, display equations with numbers;
    - outlines with page numbers, page geometry, headers and footers.
    - pictures in a line (a box drawn as a picture, a polygon) sit on its baseline and follow its alignment, and a dashed line as long as its container (`100%`) is drawn.
  
    In paged compiles html-compat does nothing.
  - **edu**: one code path for both targets (no HTML branches); it now depends on html-compat.
  - **typstream**: `<Typstream>` registers the engine's fonts for the HTML target.
- 8d2f1c5: The paged target paints pages on canvases (#14). A streamed update to a dense page costs about a millisecond on the main thread in Chromium and Safari, and 10–15 ms in Firefox; as SVG in the DOM (one element per glyph) it took 12–31 ms.
  
  - **engine-wasm:** `compile_svg_changed(true)` sends pages as drawings (`ChangedPage.drawing`): glyph outlines keyed by font and glyph, the page's operations as 32-bit floats, its strings and its links, with `svg` empty. A drawing is about a third of the SVG's size and exports three times faster. Pages with gradients, tilings or colour glyphs still come as SVG.
  - **Protocol:** `CompileParams.pageFormat` (`"svg"`, the default, or `"drawing"`) and `PageUpdate.drawing` (`PageDrawing`, `@beta`). Changing the format sends every page.
  - **engine:** `engine.open({ pageFormat })` and `EngineDocument.setPageFormat()`.
  - **dom:** `mountPaged` and `mountTypstream` ask for drawings and paint them, with a `renderer` option (`"canvas"`, the default, or `"svg"`). Canvases follow the device pixel ratio and pinch zoom, and only pages near the viewport keep their pixels. Every page is painted before printing. Links become `<a>` elements over the canvas, filtered as before. The text layer is unchanged. `createPagedView` paints any page that comes as a drawing and puts the others in shadow roots as before.
  - **react:** `renderer` prop and provider default.
- 19c08e8: The React bindings (#17). `@typstream/react` (new): `<Typstream source isStreaming />` (or `stream`) renders a streaming Typst document as HTML or pages, `TypstreamProvider` sets app-wide defaults (engine, plugins, stylesheets, theme, heal and schedule options), and `useTypstream()` reads an instance's status, diagnostics, healed source and open frames. Instances without an engine share one engine worker per page, disposed a second after the last one unmounts; documents open lazily near the viewport, so only visible or streaming ones compile. `typstream` (new) is the convenience package: the same component with html-compat and the engine's math font set up, plus the engine and healer. `@typstream/dom` adds `mountTypstream(element, options)`, the framework-free controller the bindings wrap.
- 830a374: Exports from the React component (#18). `TypstreamHandle` and `useTypstream()` add `exportPdf(options?)`, `exportHtml(options?)` and `exportSource()`, forwarded to the component's `mountTypstream`: a `layout="fit-width"` preview prints at the document's own page size, with the template's inputs and the `inputs` prop, and a lazy document that hasn't opened yet opens to export. `exportHtml` returns a standalone file with the component's plugins, stylesheets and theme. Without a mounted component they reject (`exportSource()` throws). `StandaloneHtmlOptions` and `TypstreamExportOptions` are re-exported.
  
  `mountTypstream`'s `exportPdf()` and `exportHtml()` take `{ inputs }` (`TypstreamExportOptions`): `sys.inputs` for that export only, over the template's and the mount's `inputs`, e.g. a teacher's copy (`{ showAnswers: "true" }`) of a preview showing the student's.
- 5275321: Render islands (#28, beta): interactive components mounted over markers a document's Typst writes around its own fallback drawing, which is what prints, exports and shows wherever nothing mounts. core settles the contract: `ISLAND_MARKER`, `IslandSpec { description, parse }` in the plugin's `islands` facet, `IslandProps`, and `PagedIsland` on `PagedArtifact.islands`. engine-wasm finds the paged target's island markers in each laid-out document (page, position, value, source offset), and the engine sends them with every paged artifact; `EngineDocument.file(path)` gives islands the bytes a document has. dom's HTML renderer and `mountTypstream` take `islands`, framework-free renderers by name, and keep one mounted island per marker while its block streams; `@typstream/react`'s `islands` prop renders React components into them through portals. The paged view's overlay follows the canvas pages (#14).
  
  New package `@typstream/mindmap`, the first island: mind maps written as a list (`#mindmap[…]`, `#topic(…)` for a node's colour, size, weight, image or collapsed branches, `text-focused` and one-sided styles), drawn in plain Typst, with its prompt kit; `@typstream/mindmap/react`'s `MindMapIsland` makes them interactive with React Flow (pan, zoom, open and close branches), loaded with the first map.
- 0d1c1c3: Streaming into a range of a finished document: an edit such as a model rewriting one question, where only that part heals as text being typed and the rest shows as it did. `EngineDocument.setStreamingRange(range)`, and `streamingRange` on `mountTypstream` and `<Typstream>` (with `isStreaming`; a finished document given a range streams again without starting over). Heal: `setStreamingRange` works on a finished healer (streaming mode until `finish()`); the text after a range is linted as a text of its own, so its fixes stay; `HealResult.suffixOffset` and `Healer.streamingRange`; `blockStarts` (`@beta`, moved from the engine's server) gives the top-level blocks a range should cover. The worker keeps to the range: `CompileParams.settledFrom` and `FixContext.settledFrom`, so `tail-cut` no longer drops the rest of the document with the text being typed. Layer 4's level 1 compares only what the range wrote, and the new `FallbackParams.restart` (sent after `setStreamingRange` and `reset()`) shows text that starts over even when it is shorter than what it replaces: a regenerated answer no longer keeps the old one on screen until it has caught up. `@typstream/node`'s server accepts the new fields.

### Patch Changes

- 7be4c99: A `stream` given to more than one mount is read once and shared (#81). Each mount shows all of its text, including what arrived before it mounted, so `<Typstream stream={…}>` under React StrictMode (which mounts, unmounts and mounts again) no longer loses chunks or ends early, and neither does a mount replaced while the stream continues. The stream is closed when a chunk arrives after the last mount reading it is gone, and a failed stream is reported once rather than per mount.
- Updated dependencies [ea04dbd]
- Updated dependencies [3e66075]
- Updated dependencies [4a2981f]
- Updated dependencies [12ea537]
- Updated dependencies [28374ec]
- Updated dependencies [5fa30b6]
- Updated dependencies [ba56f2e]
- Updated dependencies [6cc1c5b]
- Updated dependencies [ec38329]
- Updated dependencies [8ee7bf4]
- Updated dependencies [46e1fce]
- Updated dependencies [b880330]
- Updated dependencies [69f1477]
- Updated dependencies [fd3292c]
- Updated dependencies [d54927d]
- Updated dependencies [b4d7bed]
- Updated dependencies [813029f]
- Updated dependencies [cbb44d9]
- Updated dependencies [b2f5625]
- Updated dependencies [ac78eed]
- Updated dependencies [865949a]
- Updated dependencies [ba77608]
- Updated dependencies [cdea534]
- Updated dependencies [41ae15f]
- Updated dependencies [85ab88f]
- Updated dependencies [4ad0ae1]
- Updated dependencies [0927b74]
- Updated dependencies [8184b0f]
- Updated dependencies [7e391ce]
- Updated dependencies [8af5f77]
- Updated dependencies [a0854da]
- Updated dependencies [ea783d9]
- Updated dependencies [a014708]
- Updated dependencies [4a881a0]
- Updated dependencies [466147c]
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [0493fb6]
- Updated dependencies [e6c5a7b]
- Updated dependencies [3a11cdc]
- Updated dependencies [19c08e8]
- Updated dependencies [830a374]
- Updated dependencies [5275321]
- Updated dependencies [c620668]
- Updated dependencies [8ffe861]
- Updated dependencies [7be4c99]
- Updated dependencies [0d1c1c3]
  - @typstream/dom@0.1.0
  - @typstream/core@0.1.0
  - @typstream/engine@0.1.0
