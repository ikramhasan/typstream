# typstream

## 0.2.0

### Minor Changes

- 0441dc0: Preload the engine before the first document (beta). `engine.preload({ plugins, targets, text })` compiles
  throwaway documents so the first real one finds the wasm compiled, the fonts parsed and its plugins' packages,
  modules and fonts loaded. `prefetchEngine()` from the new `@typstream/engine/prefetch` entry downloads the default
  worker's wasm and base fonts into the browser's caches without starting a worker. `@typstream/react` and `typstream`
  add `preloadTypstream(options)`, which warms the page's shared engine and keeps it for `holdMs` (a minute; `level:
  "fetch"` only downloads), and `usePreloadTypstream(when, options)`, which keeps it warm while a component is mounted.

### Patch Changes

- Updated dependencies [0441dc0]
  - @typstream/engine@0.2.0
  - @typstream/react@0.2.0
  - @typstream/heal@0.2.0
  - @typstream/html-compat@0.1.2
  - @typstream/universe@0.1.2

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/engine@0.1.1
  - @typstream/engine-wasm@0.1.1
  - @typstream/heal@0.1.1
  - @typstream/html-compat@0.1.1
  - @typstream/react@0.1.1
  - @typstream/universe@0.1.1

## 0.1.0

### Minor Changes

- 3e66075: Plugins load through one system (#27, PLAN §8.0). `resolvePlugins` (core) loads each key once (its last definition), puts every plugin after its dependencies and otherwise keeps the given order, and rejects missing dependencies and cycles; facets it doesn't know are ignored. `createEngine({ plugins })` sends plugins' fonts, packages and fixer modules with `initialize`; `engine.open({ plugins })` resolves a document's plugins (`EngineDocument.plugins`) and applies their files, packages, preambles, heal handlers and lint settings, and fixer modules, which the worker now loads per document (`document/open`'s `fixerModules`; one that fails to load is logged and skipped). Plugins have a `stylesheets` facet, which the HTML renderer, `standaloneHtml` (new `plugins` option) and `mountTypstream` apply: html-compat and edu carry their CSS in it, so `plugins: [htmlCompat]` is enough and `typstream` no longer adds `htmlCompatCss` separately.
  
  Security: the engine server's new `clientFixers` option (default true) decides whether it imports the fixer modules a client names. `@typstream/node`'s protocol server sets it to false: it already treated clients as untrusted for packages, but still imported `initialize`'s `fixerModules`, which let a client run code in the server (a `data:` module URL).
- ac78eed: Images a document names but has no file for. Such a document used to fail to compile; now the image shows as a placeholder (a box with the file's name) that keeps the call's size and alt text and a figure's caption, while streaming and when finished. The worker stands placeholders in for every image whose path is a string without a file before the first compile (Typst stops at the first image it can't read), and a new `missing-image` fixer (`missingImage` in `@typstream/engine/server`, in `DEFAULT_FIXERS`) handles paths in variables and files whose extension names another format. Finished documents still report the error.
  
  To fill such images in, documents take a `resolveImage(path, { signal })` option (`engine.open`, `mountTypstream`, `<Typstream>` and `<TypstreamProvider>`): the client finds complete `image("…")` paths in the input, asks it once per path for the bytes, and writes them into the document's files. Diagnostics say an image is loading, or why it failed. `fetchImages({ hosts })`, in the new entry point `@typstream/engine/images` and re-exported by `typstream`, downloads `http(s)` URLs from the hosts you allow, without credentials (or through your `proxy`), accepting PNG, JPEG, GIF, WebP and SVG. Nothing is fetched by default, and the engine itself never fetches images. The engine's main-thread budget goes from 8.5 to 9.5 KB gzipped.
  
  In the HTML target, an image shrunk to fit its element or set to a width (`width: 100%`) now keeps its proportions; it used to keep the height Typst gave it and come out stretched.
- 4ad0ae1: Events and telemetry hooks (#30). The library still sends nothing itself; it reports, and the app wires the hooks. Core adds the event shapes (`CompiledEvent`, `RenderedEvent`, `FallbackEvent`, `WatchdogEvent`, `DiagnosticsEvent`, `FallbackLevel`), `CompileResult.fixes` (the errors Layer 3's fixers fixed for the output, as `AppliedFix`) and `CompileFallback.level` (2 stable prefix, 3 error blocks, 4 the whole document). The engine client times healing on the main thread and emits every document's events through `EngineDocument.onEvent` and, as `{ type: "document", event }`, `Engine.onEvent`. `mountTypstream` and `<Typstream>` take `onFallback` and `onWatchdog`, and `onRendered` now receives a `RenderedEvent` (rev, timings, compile and heal ms, patches by reason, fixes, fallback level, render ms, blocks or pages) in place of the `@beta` `RenderedInfo`, which is gone. `TypstreamProvider` takes the telemetry hooks too, and calls them alongside each instance's. `@typstream/node`'s protocol server reports the fallback level.
- 8184b0f: Typst packages (#25). Documents may `#import "@preview/…"` packages from an allowlist: `initialize.packages`, plus a document's own (`document/open`'s new `packages`, filled from plugins' `engine.packages` by `mountTypstream`).
  - **Loading.** Before each compile the engine server scans the preamble and document for package specs. It fetches only allowed packages, checks their integrity, untars them into the document's files under `@ns/name:version/…` keys (engine-wasm roots those at the package), and follows the packages' own imports. Tarballs are kept in Cache Storage, and a package that arrives after the compile stopped waiting compiles the revision again.
  - **Versions and errors.** Another version of an allowed package gets the nearest allowed one, with a warning. A missing one is reported as not allowed, still loading or failed to load, and the new `package-stub` fixer binds what it imported to placeholders.
  - **Local packages.** Files keyed by a package spec mount a local package, e.g. `@typstream/edu:0.1.0/lib.typ`.
  - **Servers.** `ServerOptions.packages` sets a server's own allowlist, registry and cache; `@typstream/node` ignores client package lists.
  - **New package.** `@typstream/universe` vendors CeTZ 0.5.3, fletcher 0.5.8, cetz-plot 0.1.4, physica 0.9.8, unify 0.8.1, chemformula 0.1.3 and alchemist 0.2.0 with their dependencies, as an allowlist plugin with prompt rules. `typstream` enables it by default (`packages={false}` turns it off).
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
- 19c08e8: The React bindings (#17). `@typstream/react` (new): `<Typstream source isStreaming />` (or `stream`) renders a streaming Typst document as HTML or pages, `TypstreamProvider` sets app-wide defaults (engine, plugins, stylesheets, theme, heal and schedule options), and `useTypstream()` reads an instance's status, diagnostics, healed source and open frames. Instances without an engine share one engine worker per page, disposed a second after the last one unmounts; documents open lazily near the viewport, so only visible or streaming ones compile. `typstream` (new) is the convenience package: the same component with html-compat and the engine's math font set up, plus the engine and healer. `@typstream/dom` adds `mountTypstream(element, options)`, the framework-free controller the bindings wrap.
- 830a374: Exports from the React component (#18). `TypstreamHandle` and `useTypstream()` add `exportPdf(options?)`, `exportHtml(options?)` and `exportSource()`, forwarded to the component's `mountTypstream`: a `layout="fit-width"` preview prints at the document's own page size, with the template's inputs and the `inputs` prop, and a lazy document that hasn't opened yet opens to export. `exportHtml` returns a standalone file with the component's plugins, stylesheets and theme. Without a mounted component they reject (`exportSource()` throws). `StandaloneHtmlOptions` and `TypstreamExportOptions` are re-exported.
  
  `mountTypstream`'s `exportPdf()` and `exportHtml()` take `{ inputs }` (`TypstreamExportOptions`): `sys.inputs` for that export only, over the template's and the mount's `inputs`, e.g. a teacher's copy (`{ showAnswers: "true" }`) of a preview showing the student's.

### Patch Changes

- Updated dependencies [ea04dbd]
- Updated dependencies [3e66075]
- Updated dependencies [4a2981f]
- Updated dependencies [28374ec]
- Updated dependencies [3827c1c]
- Updated dependencies [5fa30b6]
- Updated dependencies [ba56f2e]
- Updated dependencies [c14509b]
- Updated dependencies [d54927d]
- Updated dependencies [feba233]
- Updated dependencies [6cc1c5b]
- Updated dependencies [5f49264]
- Updated dependencies [ec38329]
- Updated dependencies [8ee7bf4]
- Updated dependencies [46e1fce]
- Updated dependencies [69f1477]
- Updated dependencies [fd3292c]
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
- Updated dependencies [558108b]
- Updated dependencies [a6cff6a]
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [fdb250d]
- Updated dependencies [3a11cdc]
- Updated dependencies [19c08e8]
- Updated dependencies [830a374]
- Updated dependencies [5275321]
- Updated dependencies [8ffe861]
- Updated dependencies [7be4c99]
- Updated dependencies [0d1c1c3]
  - @typstream/heal@0.1.0
  - @typstream/html-compat@0.1.0
  - @typstream/engine@0.1.0
  - @typstream/engine-wasm@0.1.0
  - @typstream/react@0.1.0
  - @typstream/universe@0.1.0
