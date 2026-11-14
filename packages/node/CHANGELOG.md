# @typstream/node

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
- 6cc1c5b: DOCX exports draw what Word can't express as pictures instead of empty space (#133): images, CeTZ and fletcher
  canvases, mind maps, edu's number lines, graph paper and coordinate planes (their descriptions as alt text), and
  boxes with rounded corners, each as Typst drew it, at its size and place: SVG from typst-svg, which Word 2016 and later,
  LibreOffice and ONLYOFFICE draw, with a 300 DPI PNG for older Word and other apps, rendered in the wasm (typst-render's
  rasterizer, vendored without PDF images). A `place`d drawing is anchored to the page. Free-form content a picture
  holds (a box with rounded corners, rotated text) is a `docx/fallback` warning, and edu's prompt kit steers models to
  its callouts instead.
  
  DOCX exports also write Typst's `super` and `sub` (set with the font's own glyphs) as Word's superscript and subscript,
  keep the label of a list item that starts with a table, and keep an inline equation in a list inside a block (its Word
  math was dropped when a fraction made its line look wrapped).
- cbb44d9: Layer 4, the fallback ladder (#21): a document that still doesn't compile after the fixers renders anyway. Clients ask for it per compile with core's new `CompileParams.fallback` (`isolate`, `stablePrefix`, `skip`); `CompileResult.fallback` says what the artifact shows instead of the text and `timings.fallbackMs` what it cost. The engine server shows each top-level block that fails as an error block ("This part couldn't be displayed", the error, the block's source), found by bisecting prefixes with check compiles (new optional `AdapterDocument.check`); while streaming it shows the unsettled tail as plain text below the settled text once the client's last good render is stale (`ScheduleOptions.staleMs`, 1.5 s), and in final mode the whole document as source as a last resort. The engine client asks for it with every compile (`DocumentOptions.fallback: false` turns it off), and when a finished document runs past the watchdog or crashes the worker it finds the blocks responsible by compiling prefixes, each under `WatchdogOptions.probeMs`, and skips them. `@typstream/node`'s protocol server accepts the new params and checks prefixes on its pool, where a stopped compile isolates its block.
- 865949a: Pages follow typstream's layout profile (#129), so a DOCX export can break lines and pages where Typst does: a
  constant line pitch (1.3em, close to Typst's default), ragged right without hyphenation, table rows that don't split,
  and inline math at least a line tall. The engine puts it (`LAYOUT_PROFILE`, from `@typstream/engine/server`) in front
  of every document and its preamble when it compiles pages or exports a PDF; `@typstream/node` does too. Its show-set
  rules win over a document's set rules; heal's new `layout-profile` lint rule takes out the arguments that would win
  (`par(justify: true)[…]`, `show par: set par(…)`, `show text: set text(hyphenate: …)`). Every page looks a little
  different: default gaps between paragraphs and headings are smaller to keep Typst's distances between baselines, and
  some documents that set their own table insets or spacing gain a page. edu's spacing, answer lines, circled answers and
  blanks are adjusted to keep their look under the profile. `fromMain` takes where the preamble starts, after the
  profile. html-compat's placed text uses the profile's text edges.
- ba77608: Lazy fonts (#11). Arabic, Bengali and Devanagari render with their own fonts (Noto Naskh Arabic, Noto Serif Bengali, Noto Serif Devanagari, regular and bold), downloaded by the engine worker only when a document uses them. engine-wasm's fonts now belong to the wasm instance, shared by every `Engine` (`Engine.add_font` is static), and can be registered before their bytes arrive: `Engine.font_info(bytes)` gives a file's metadata, `Engine.register_font(info)` puts its faces in the font book, `Engine.load_font(id, bytes)` gives them their bytes, and every compile lists the fonts it wanted but lacked in `missingFonts`. `@typstream/engine-wasm/fonts` exports `scriptFonts` next to `baseFonts`. The engine-wasm adapter takes `lazyFonts` and `fontCache` (Cache Storage, default `"typstream-fonts"`, which base fonts use too), and the default worker registers `scriptFonts`. An adapter compile can return `pending`: the server recompiles the document on its own once it resolves, and exports wait for it. `FontSource.info` makes an app's own font lazy. `@typstream/node` loads the script fonts up front (`scriptFonts: false` to leave them out). The HTML renderer's theme gives each paragraph the direction of its text (`unicode-bidi: plaintext`), since Typst's HTML export doesn't mark right-to-left text.
- 8184b0f: Typst packages (#25). Documents may `#import "@preview/…"` packages from an allowlist: `initialize.packages`, plus a document's own (`document/open`'s new `packages`, filled from plugins' `engine.packages` by `mountTypstream`).
  - **Loading.** Before each compile the engine server scans the preamble and document for package specs. It fetches only allowed packages, checks their integrity, untars them into the document's files under `@ns/name:version/…` keys (engine-wasm roots those at the package), and follows the packages' own imports. Tarballs are kept in Cache Storage, and a package that arrives after the compile stopped waiting compiles the revision again.
  - **Versions and errors.** Another version of an allowed package gets the nearest allowed one, with a warning. A missing one is reported as not allowed, still loading or failed to load, and the new `package-stub` fixer binds what it imported to placeholders.
  - **Local packages.** Files keyed by a package spec mount a local package, e.g. `@typstream/edu:0.1.0/lib.typ`.
  - **Servers.** `ServerOptions.packages` sets a server's own allowlist, registry and cache; `@typstream/node` ignores client package lists.
  - **New package.** `@typstream/universe` vendors CeTZ 0.5.3, fletcher 0.5.8, cetz-plot 0.1.4, physica 0.9.8, unify 0.8.1, chemformula 0.1.3 and alchemist 0.2.0 with their dependencies, as an allowlist plugin with prompt rules. `typstream` enables it by default (`packages={false}` turns it off).
- 60c1567: New package `@typstream/node` (#22): `validate` and `render` (PDF, HTML, SVG) on the server, `formatDiagnosticsForLLM` and `fixLoop` for LLM repair, and the worker protocol over WebSocket (`createProtocolServer`, `handleWebSocket`). It runs `@typstream/engine-wasm` on worker threads with a watchdog per compile.
  
  `@typstream/core` adds `serializeMessage` / `deserializeMessage`, a JSON wire format for protocol messages that carries bytes as base64.
  
  `@typstream/engine`'s server passes each compile's `mode` to the adapter (`AdapterCompileOptions`; exports are `final`), answers unknown methods with `method-not-found`, and exports `fromMain`. `@typstream/node` serves the protocol with it.
  
  `@typstream/engine-wasm` adds `check_paged()` (a paged compile without export) and PDF export (`compile_pdf()`).

### Patch Changes

- 3e66075: Plugins load through one system (#27, PLAN §8.0). `resolvePlugins` (core) loads each key once (its last definition), puts every plugin after its dependencies and otherwise keeps the given order, and rejects missing dependencies and cycles; facets it doesn't know are ignored. `createEngine({ plugins })` sends plugins' fonts, packages and fixer modules with `initialize`; `engine.open({ plugins })` resolves a document's plugins (`EngineDocument.plugins`) and applies their files, packages, preambles, heal handlers and lint settings, and fixer modules, which the worker now loads per document (`document/open`'s `fixerModules`; one that fails to load is logged and skipped). Plugins have a `stylesheets` facet, which the HTML renderer, `standaloneHtml` (new `plugins` option) and `mountTypstream` apply: html-compat and edu carry their CSS in it, so `plugins: [htmlCompat]` is enough and `typstream` no longer adds `htmlCompatCss` separately.
  
  Security: the engine server's new `clientFixers` option (default true) decides whether it imports the fixer modules a client names. `@typstream/node`'s protocol server sets it to false: it already treated clients as untrusted for packages, but still imported `initialize`'s `fixerModules`, which let a client run code in the server (a `data:` module URL).
- cdea534: Devanagari text with no font set renders in Noto Serif Devanagari, with its shaping, instead of New Computer Modern Math (#80). Typst's fallback picked the math font, which also covers Devanagari, because it is more like Libertinus Serif by Typst's measure. A math font is no longer a fallback for the letters of scripts other than Latin and Greek; its symbols and math alphabets still are, and equations, Arabic and Bengali render as before.
- 4ad0ae1: Events and telemetry hooks (#30). The library still sends nothing itself; it reports, and the app wires the hooks. Core adds the event shapes (`CompiledEvent`, `RenderedEvent`, `FallbackEvent`, `WatchdogEvent`, `DiagnosticsEvent`, `FallbackLevel`), `CompileResult.fixes` (the errors Layer 3's fixers fixed for the output, as `AppliedFix`) and `CompileFallback.level` (2 stable prefix, 3 error blocks, 4 the whole document). The engine client times healing on the main thread and emits every document's events through `EngineDocument.onEvent` and, as `{ type: "document", event }`, `Engine.onEvent`. `mountTypstream` and `<Typstream>` take `onFallback` and `onWatchdog`, and `onRendered` now receives a `RenderedEvent` (rev, timings, compile and heal ms, patches by reason, fixes, fallback level, render ms, blocks or pages) in place of the `@beta` `RenderedInfo`, which is gone. `TypstreamProvider` takes the telemetry hooks too, and calls them alongside each instance's. `@typstream/node`'s protocol server reports the fallback level.
- 0927b74: The base fonts have TrueType outlines (#118): the build converts Libertinus Serif and New Computer Modern Math, which
  typst-assets ships with CFF outlines that Word won't embed, so the paged view, the PDF and a DOCX can use the same
  files. They lay out the same. The files are renamed: `dist/fonts/LibertinusSerif-{Regular,Bold,Italic}.ttf` and
  `NewCMMath-Regular.ttf` (were `.otf`); `baseFonts` has the new URLs. `@typstream/node` serves the same conversions, and
  `standaloneHtml` labels an embedded math font with its actual media type.
- ea783d9: Exports from the same compiled document (#18). `EngineDocument` adds `exportPdf()`, `exportHtml()` and `exportSource()`. Exports run in the preview's worker, ahead of waiting compiles and under the final watchdog budget. They reject with `ExportError` (`reason` plus diagnostics in input coordinates). The engine-wasm adapter offers PDF export, and `AdapterDocument.exportPdf` receives the compile `mode`.
  
  `@typstream/engine-wasm` has PDF in its one build: the `pdf` cargo feature is on by default, and `dist/pdf` / `@typstream/engine-wasm/pdf` are gone. The wasm budget is 6.3 MB brotli. `@typstream/node` now runs the default build.
  
  `@typstream/dom` adds `standaloneHtml(html, options)`. It makes an HTML export a file that opens on its own, with the theme, plugin stylesheets, an optional math font, and a Content-Security-Policy that keeps the document's scripts from running.
  
  `mountTypstream` gains `exportPdf()`, `exportHtml()` (the standalone file) and `exportSource()`. They export at the document's own page size, leaving out a fit-width preview's width.
- 4a881a0: Every engine chooses from the same font faces (#128). engine-wasm ships all 17 faces of Typst's bundled fonts with
  TrueType outlines: the base fonts now have New Computer Modern Math's Book face, the one Typst sets math in (it had
  Regular, so equations in the browser were lighter than native typst drew them), and the other 12 faces (Libertinus Serif
  bold italic and semibold, New Computer Modern, the math font's regular and bold, DejaVu Sans Mono bold and oblique) are
  the new `extraFonts`, which the default worker registers lazily. `@typstream/node` serves the same files.
- 466147c: Font catalogues, and `@typstream/google-fonts`: documents can use any Google Fonts family by name (`#set text(font: "Lora")`). A catalogue (`FontCatalogue`, plugins' `engine.fontCatalogues`, also from a document's plugins) is an index of families and their font files; when a compile names a family the engine doesn't have, the worker looks it up, loads its files (`EngineAdapter.addFonts`) and compiles the document again, and announces it (`fonts/loaded`, `Engine.fonts`, the `font` event). In the HTML target, google-fonts' preamble marks text in another font with its family, and `mountTypstream` shows the families the engine loaded as web fonts made from the same files (`registerLoadedFont`); `standaloneHtml({ fonts })` links them. `@typstream/node`'s server ignores clients' catalogues.
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
- 3a11cdc: Every `@public` and `@beta` export and member has TSDoc (#33): the protocol and plugin types in core, heal's results, options and recognizer types, and `@typstream/node`'s options and results, so editors show what each one means. `HealHandler.priority`'s comment said the built-in lint rules run at 50; they run before every handler, and a handler's default priority is 100. heal's `Mode` and `ModeSpan` are now `@internal`: they were reachable only through the internal `Recognition.modes` (handlers see core's `SyntaxMode`).
- 0d1c1c3: Streaming into a range of a finished document: an edit such as a model rewriting one question, where only that part heals as text being typed and the rest shows as it did. `EngineDocument.setStreamingRange(range)`, and `streamingRange` on `mountTypstream` and `<Typstream>` (with `isStreaming`; a finished document given a range streams again without starting over). Heal: `setStreamingRange` works on a finished healer (streaming mode until `finish()`); the text after a range is linted as a text of its own, so its fixes stay; `HealResult.suffixOffset` and `Healer.streamingRange`; `blockStarts` (`@beta`, moved from the engine's server) gives the top-level blocks a range should cover. The worker keeps to the range: `CompileParams.settledFrom` and `FixContext.settledFrom`, so `tail-cut` no longer drops the rest of the document with the text being typed. Layer 4's level 1 compares only what the range wrote, and the new `FallbackParams.restart` (sent after `setStreamingRange` and `reset()`) shows text that starts over even when it is shorter than what it replaces: a regenerated answer no longer keeps the old one on screen until it has caught up. `@typstream/node`'s server accepts the new fields.
- Updated dependencies [ea04dbd]
- Updated dependencies [3e66075]
- Updated dependencies [12ea537]
- Updated dependencies [28374ec]
- Updated dependencies [3827c1c]
- Updated dependencies [5fa30b6]
- Updated dependencies [ba56f2e]
- Updated dependencies [193687a]
- Updated dependencies [3edcd4d]
- Updated dependencies [c14509b]
- Updated dependencies [d54927d]
- Updated dependencies [feba233]
- Updated dependencies [6cc1c5b]
- Updated dependencies [5f49264]
- Updated dependencies [ec38329]
- Updated dependencies [46e1fce]
- Updated dependencies [69f1477]
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
- Updated dependencies [b880330]
- Updated dependencies [ba55345]
- Updated dependencies [aef5d68]
- Updated dependencies [b880330]
- Updated dependencies
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [e6c5a7b]
- Updated dependencies [fdb250d]
- Updated dependencies [3a11cdc]
- Updated dependencies [5275321]
- Updated dependencies [c620668]
- Updated dependencies [8ffe861]
- Updated dependencies [0d1c1c3]
  - @typstream/heal@0.1.0
  - @typstream/core@0.1.0
  - @typstream/engine@0.1.0
  - @typstream/docx@0.1.0
  - @typstream/engine-wasm@0.1.0
