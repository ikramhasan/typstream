# @typstream/engine-wasm

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.

## 0.1.0

### Minor Changes

- 5fa30b6: DOCX exports write equations as editable Word equations (OMML) instead of empty space (#132): fractions, scripts and
  limits, roots, brackets, matrices and `cases`, big operators and function names with their operands, accents, braces
  and aligned lines, inline in their line or displayed (a numbered one with its number at the right), in Typst's math
  font. engine-wasm reads them from Typst's own math layout's first step during the export's compile. The layout profile
  now keeps Typst's default spacing between the lines of a display equation with line breaks (the profile's `leading: 0`
  made them touch).
  
  DOCX exports also number pages as Typst does (roman numerals, a restart after the front matter: Word sections), write
  outlines with Word's dot leaders, keep a centred table's columns and borders, and keep answer lines apart.
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
- 5f49264: DOCX exports in other scripts (#134): Arabic and Hebrew right to left (`w:bidi` paragraphs with mirrored alignment,
  indents, lists and tables, `w:rtl` runs), Bengali and Devanagari text written once though Typst draws vowel signs
  apart, each run with its language, Word's Hindi numbers for Devanagari page numbers, and gaps among complex-script
  text that ONLYOFFICE keeps. Also: short lines between paragraphs, centred floats in columns, and paragraphs whose text
  size changes between lines.
- 69f1477: The paged renderer (#14). `@typstream/dom` is new: `mountPaged(container, doc)` shows an engine document as SVG pages and keeps them in step, redrawing only pages whose hash changed (visible ones at the next frame, the rest in idle time), with a selectable, searchable text layer, sanitized links, and `fixed` or `fit-width` layouts (`FIT_WIDTH_PREAMBLE`). `createPagedView` is the same renderer without the document. engine-wasm now returns each changed page's text runs (`ChangedPage.text`), and core's `PageUpdate` has an optional `text: TextRun[]`.
- ba77608: Lazy fonts (#11). Arabic, Bengali and Devanagari render with their own fonts (Noto Naskh Arabic, Noto Serif Bengali, Noto Serif Devanagari, regular and bold), downloaded by the engine worker only when a document uses them. engine-wasm's fonts now belong to the wasm instance, shared by every `Engine` (`Engine.add_font` is static), and can be registered before their bytes arrive: `Engine.font_info(bytes)` gives a file's metadata, `Engine.register_font(info)` puts its faces in the font book, `Engine.load_font(id, bytes)` gives them their bytes, and every compile lists the fonts it wanted but lacked in `missingFonts`. `@typstream/engine-wasm/fonts` exports `scriptFonts` next to `baseFonts`. The engine-wasm adapter takes `lazyFonts` and `fontCache` (Cache Storage, default `"typstream-fonts"`, which base fonts use too), and the default worker registers `scriptFonts`. An adapter compile can return `pending`: the server recompiles the document on its own once it resolves, and exports wait for it. `FontSource.info` makes an app's own font lazy. `@typstream/node` loads the script fonts up front (`scriptFonts: false` to leave them out). The HTML renderer's theme gives each paragraph the direction of its text (`unicode-bidi: plaintext`), since Typst's HTML export doesn't mark right-to-left text.
- 0927b74: The base fonts have TrueType outlines (#118): the build converts Libertinus Serif and New Computer Modern Math, which
  typst-assets ships with CFF outlines that Word won't embed, so the paged view, the PDF and a DOCX can use the same
  files. They lay out the same. The files are renamed: `dist/fonts/LibertinusSerif-{Regular,Bold,Italic}.ttf` and
  `NewCMMath-Regular.ttf` (were `.otf`); `baseFonts` has the new URLs. `@typstream/node` serves the same conversions, and
  `standaloneHtml` labels an embedded math font with its actual media type.
- 8184b0f: Typst packages (#25). Documents may `#import "@preview/…"` packages from an allowlist: `initialize.packages`, plus a document's own (`document/open`'s new `packages`, filled from plugins' `engine.packages` by `mountTypstream`).
  - **Loading.** Before each compile the engine server scans the preamble and document for package specs. It fetches only allowed packages, checks their integrity, untars them into the document's files under `@ns/name:version/…` keys (engine-wasm roots those at the package), and follows the packages' own imports. Tarballs are kept in Cache Storage, and a package that arrives after the compile stopped waiting compiles the revision again.
  - **Versions and errors.** Another version of an allowed package gets the nearest allowed one, with a warning. A missing one is reported as not allowed, still loading or failed to load, and the new `package-stub` fixer binds what it imported to placeholders.
  - **Local packages.** Files keyed by a package spec mount a local package, e.g. `@typstream/edu:0.1.0/lib.typ`.
  - **Servers.** `ServerOptions.packages` sets a server's own allowlist, registry and cache; `@typstream/node` ignores client package lists.
  - **New package.** `@typstream/universe` vendors CeTZ 0.5.3, fletcher 0.5.8, cetz-plot 0.1.4, physica 0.9.8, unify 0.8.1, chemformula 0.1.3 and alchemist 0.2.0 with their dependencies, as an allowlist plugin with prompt rules. `typstream` enables it by default (`packages={false}` turns it off).
- a0854da: The engine's worker half (#10). `@typstream/engine/server` has the protocol server (`serve`, `createServer`, `inProcess`), the `EngineAdapter` interface and the engine-wasm adapter (`engineWasm`); `engineWorker()` spawns the default worker, which bundlers (Vite, Next.js) pick up with the wasm and fonts. engine-wasm now ships the base fonts (`@typstream/engine-wasm/fonts`) and reports each changed page's `hash`, `width` and `height`.
- ea783d9: Exports from the same compiled document (#18). `EngineDocument` adds `exportPdf()`, `exportHtml()` and `exportSource()`. Exports run in the preview's worker, ahead of waiting compiles and under the final watchdog budget. They reject with `ExportError` (`reason` plus diagnostics in input coordinates). The engine-wasm adapter offers PDF export, and `AdapterDocument.exportPdf` receives the compile `mode`.
  
  `@typstream/engine-wasm` has PDF in its one build: the `pdf` cargo feature is on by default, and `dist/pdf` / `@typstream/engine-wasm/pdf` are gone. The wasm budget is 6.3 MB brotli. `@typstream/node` now runs the default build.
  
  `@typstream/dom` adds `standaloneHtml(html, options)`. It makes an HTML export a file that opens on its own, with the theme, plugin stylesheets, an optional math font, and a Content-Security-Policy that keeps the document's scripts from running.
  
  `mountTypstream` gains `exportPdf()`, `exportHtml()` (the standalone file) and `exportSource()`. They export at the document's own page size, leaving out a fit-width preview's width.
- 4a881a0: Every engine chooses from the same font faces (#128). engine-wasm ships all 17 faces of Typst's bundled fonts with
  TrueType outlines: the base fonts now have New Computer Modern Math's Book face, the one Typst sets math in (it had
  Regular, so equations in the browser were lighter than native typst drew them), and the other 12 faces (Libertinus Serif
  bold italic and semibold, New Computer Modern, the math font's regular and bold, DejaVu Sans Mono bold and oblique) are
  the new `extraFonts`, which the default worker registers lazily. `@typstream/node` serves the same files.
- 60c1567: New package `@typstream/node` (#22): `validate` and `render` (PDF, HTML, SVG) on the server, `formatDiagnosticsForLLM` and `fixLoop` for LLM repair, and the worker protocol over WebSocket (`createProtocolServer`, `handleWebSocket`). It runs `@typstream/engine-wasm` on worker threads with a watchdog per compile.
  
  `@typstream/core` adds `serializeMessage` / `deserializeMessage`, a JSON wire format for protocol messages that carries bytes as base64.
  
  `@typstream/engine`'s server passes each compile's `mode` to the adapter (`AdapterCompileOptions`; exports are `final`), answers unknown methods with `method-not-found`, and exports `fromMain`. `@typstream/node` serves the protocol with it.
  
  `@typstream/engine-wasm` adds `check_paged()` (a paged compile without export) and PDF export (`compile_pdf()`).
- 8d2f1c5: The paged target paints pages on canvases (#14). A streamed update to a dense page costs about a millisecond on the main thread in Chromium and Safari, and 10–15 ms in Firefox; as SVG in the DOM (one element per glyph) it took 12–31 ms.
  
  - **engine-wasm:** `compile_svg_changed(true)` sends pages as drawings (`ChangedPage.drawing`): glyph outlines keyed by font and glyph, the page's operations as 32-bit floats, its strings and its links, with `svg` empty. A drawing is about a third of the SVG's size and exports three times faster. Pages with gradients, tilings or colour glyphs still come as SVG.
  - **Protocol:** `CompileParams.pageFormat` (`"svg"`, the default, or `"drawing"`) and `PageUpdate.drawing` (`PageDrawing`, `@beta`). Changing the format sends every page.
  - **engine:** `engine.open({ pageFormat })` and `EngineDocument.setPageFormat()`.
  - **dom:** `mountPaged` and `mountTypstream` ask for drawings and paint them, with a `renderer` option (`"canvas"`, the default, or `"svg"`). Canvases follow the device pixel ratio and pinch zoom, and only pages near the viewport keep their pixels. Every page is painted before printing. Links become `<a>` elements over the canvas, filtered as before. The text layer is unchanged. `createPagedView` paints any page that comes as a drawing and puts the others in shadow roots as before.
  - **react:** `renderer` prop and provider default.
- 5275321: Render islands (#28, beta): interactive components mounted over markers a document's Typst writes around its own fallback drawing, which is what prints, exports and shows wherever nothing mounts. core settles the contract: `ISLAND_MARKER`, `IslandSpec { description, parse }` in the plugin's `islands` facet, `IslandProps`, and `PagedIsland` on `PagedArtifact.islands`. engine-wasm finds the paged target's island markers in each laid-out document (page, position, value, source offset), and the engine sends them with every paged artifact; `EngineDocument.file(path)` gives islands the bytes a document has. dom's HTML renderer and `mountTypstream` take `islands`, framework-free renderers by name, and keep one mounted island per marker while its block streams; `@typstream/react`'s `islands` prop renders React components into them through portals. The paged view's overlay follows the canvas pages (#14).
  
  New package `@typstream/mindmap`, the first island: mind maps written as a list (`#mindmap[…]`, `#topic(…)` for a node's colour, size, weight, image or collapsed branches, `text-focused` and one-sided styles), drawn in plain Typst, with its prompt kit; `@typstream/mindmap/react`'s `MindMapIsland` makes them interactive with React Flow (pan, zoom, open and close branches), loaded with the first map.

### Patch Changes

- 28374ec: DOCX exports keep what the page shows where they lost it while their lines still matched (#118). An answer line under
  a callout in a question is no longer dropped (LibreOffice drops an empty paragraph after a table at a cell's end); an
  equation starting or ending in an operator (`$1/5 + 2/5 =$`, an aligned equation's `&= 22`) or with absolute-value
  bars no longer shows LibreOffice's red "¿", and an equation that is only an operator (`$->$`) is set without spacing;
  a blank that is a list item's whole body (`1. #box(stroke: (bottom: …))` in a table cell), a term's or a line's first
  stays on its line, underlined; a list item's number Typst kept at the left of a centred cell stays there; a line a `\`
  broke where Typst would have broken anyway keeps its break, an empty line between such lines its room, and a line
  after one starting with `h()` its room; a code block's lines and right-aligned or centred lines no longer wrap in
  Word, and centred and right-aligned lines are centred and right-aligned paragraphs; list numbers keep their labels'
  face, size and colour (not a bold first word's); a list starting at "v." is numbered in Roman numerals. Highlights and
  filled boxes around words are Word's shading (in their colour as it shows on paper: `highlight`'s yellow is
  translucent), strikethrough is Word's, dashed and dotted frames have Word's dashed and dotted borders, a dashed line
  is a picture, and a gradient is a picture whose SVG LibreOffice draws (typst-svg's referencing gradients are
  flattened).
  
  The layout profile turns hanging punctuation off (`overhang: false`), as Word has none. Heal's `layout-profile` lint
  rule takes a small fixed `radius` (a text box's, up to 12 pt) out of `block`, `rect` and `box` calls that hold content
  and out of their set rules: a box with rounded corners around text was a picture in a DOCX export, its text not
  editable; a square one is a table cell. A ratio or a larger radius draws a shape, which stays as it is.
- 3827c1c: DOCX exports match the page more closely (#135): a blank's underline keeps the colour of the line Typst draws
  (`underlineColor` on text and gap runs) and stays underlined at the start or end of a paragraph; a shown answer is a
  paragraph of its own under its question; an inline equation broken over two lines comes after the text before it;
  a table that ends on a later page keeps its borders and height there; answer lines in a table row split across pages
  are kept. edu draws a blank's line where Word underlines (0.078em below the baseline), keeps a blank alone in a cell on
  a text line, and puts a student field's line at the bottom of its label's line.
- c14509b: DOCX exports draw rules, borders and blanks where the page does (#118): a blank drawn as a box stroked underneath
  (on the baseline) is raised or lowered so Word's underline lands on Typst's line (`raise` on gap runs, from the font's
  underline position), and keeps its underline next to `h(1fr)`; a blank alone in its paragraph sits on its line; a
  `line` in a list no longer pushes what follows down by half its stroke; a table going on to another page keeps its
  cells' side borders there (its strokes there start just above the top margin, and were taken for the header's); a box
  holding boxes takes its insets from them, not from their text; columns under a float keep the room above them; a
  block Typst moves to the next page whole in a table cell (answer lines under a question) leaves the room it left on
  the page before (a breakable spacer, `breakable` on drawings) and its gap from the new page's top. A box stroked on its
  sides in a line (a checkbox) is a picture, anchored to its line where Typst lowered it below the baseline (`line` on a
  picture in a line), since LibreOffice won't lower a drawing in the line.
- d54927d: DOCX pictures inline the SVG images they hold. An SVG image (a Mermaid diagram's shapes) was a data-URL `<image>` inside the picture's SVG, which LibreOffice 26.2 draws with some strokes a fraction of a point off (round-capped lines and dashes); it is now a nested `<svg>` of the image's box with the image's content, its ids prefixed, which LibreOffice draws as Typst's PDF has it. Images with a doctype or a style sheet (whose selectors would then apply to the whole picture), and raster images, stay as they are.
- feba233: DOCX exports open in Apple's Pages closer to the page: Pages reads no cell margins (its cells' text is 4 points in from each side), so a cell's margins past that are its paragraphs' indents, and a column whose one-line cells Pages would wrap takes room from the cell before it, which Word sees as wider margins; each row has the height Typst gave it less its margins and borders, at least (engine-wasm's model records each row's `height` and each cell paragraph's `room`); and the gap above a table is a paragraph of its own, as Pages sets a table in a paragraph made like the one before it (its spacing, page break and keep with next). Each change keeps what Word sets where it was; LibreOffice lays the files out as before.
- cdea534: Devanagari text with no font set renders in Noto Serif Devanagari, with its shaping, instead of New Computer Modern Math (#80). Typst's fallback picked the math font, which also covers Devanagari, because it is more like Libertinus Serif by Typst's measure. A math font is no longer a fallback for the letters of scripts other than Latin and Greek; its symbols and math alphabets still are, and equations, Arabic and Bengali render as before.
