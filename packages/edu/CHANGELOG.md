# @typstream/edu

## 0.2.0

### Minor Changes

- 47499e4: DOCX exports can be filled in. A blank is underlined no-break spaces of their own width, so letters typed in
  it are no longer spread a blank apart; an empty line to write on (edu's answer lines, a student's details, a matching
  letter) has a line to type on above its rule, in the text's face and size, instead of room no text fits in; and the
  space after a blank that ends a line is no longer underlined. edu's `student-info` (and a template's `info`) fills
  fields in: `info: (name: [Ikram Hasan], class: [9B], date: none)` writes the name and class on their lines and leaves
  the date empty. A matching exercise's letter line sits at the bottom of its line, as `student-info`'s do.

### Patch Changes

- @typstream/core@0.2.0

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/core@0.1.1

## 0.1.0

### Minor Changes

- 3e66075: Plugins load through one system (#27, PLAN §8.0). `resolvePlugins` (core) loads each key once (its last definition), puts every plugin after its dependencies and otherwise keeps the given order, and rejects missing dependencies and cycles; facets it doesn't know are ignored. `createEngine({ plugins })` sends plugins' fonts, packages and fixer modules with `initialize`; `engine.open({ plugins })` resolves a document's plugins (`EngineDocument.plugins`) and applies their files, packages, preambles, heal handlers and lint settings, and fixer modules, which the worker now loads per document (`document/open`'s `fixerModules`; one that fails to load is logged and skipped). Plugins have a `stylesheets` facet, which the HTML renderer, `standaloneHtml` (new `plugins` option) and `mountTypstream` apply: html-compat and edu carry their CSS in it, so `plugins: [htmlCompat]` is enough and `typstream` no longer adds `htmlCompatCss` separately.
  
  Security: the engine server's new `clientFixers` option (default true) decides whether it imports the fixer modules a client names. `@typstream/node`'s protocol server sets it to false: it already treated clients as untrusted for packages, but still imported `initialize`'s `fixerModules`, which let a client run code in the server (a `data:` module URL).
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
- ec38329: A document in the HTML target stays inside its element (#69). The renderer's stylesheet clips its root (`position: relative; overflow: clip; clip-path: inset(0)` on `.typstream`), so nothing the document draws, or the page's CSS gives it, paints or takes clicks outside the element: not a viewport-sized `position: absolute` box, a `transform`, negative margins, nor a `position: fixed` that a page class applies. Layout doesn't change (no new formatting context); what reached past the element, such as a table wider than it, is now cut off. The sanitizer keeps only the classes Typst writes, the engine's `typstream-*` placeholders and the ones plugins list in the new `sanitize.allowClasses` facet (names, or prefixes like `"ts-*"`), so a document can no longer take on the page's own classes (Tailwind's `fixed inset-0 z-50`, an app's buttons). html-compat allows `ts-*` and edu `edu-*`; a plugin whose Typst writes classes for its stylesheet must list them.
- 25af154: Callouts and the instructions box are a thin frame with the title set into its top edge, like a fieldset's legend, instead of a tinted panel with a bar. They print cleanly in black and white, and look like a printed worksheet rather than a web page. Both targets match: the paged target draws the label over the frame on the page's fill; the HTML target (`eduCss`) draws the frame in pieces around the title, so it needs no background colour and works on any page, in light and dark themes. The title sits on the starting side, at the top right in Arabic. A callout with `title: none` keeps a whole frame.
- 2cc34dc: New package: the Typst vocabulary for teachers' documents (#23). Templates (worksheet, quiz, exam, lesson plan, handout), numbered questions with points and totals, multiple choice, true/false, matching, blanks, answer lines and spaces, worked answers and an answer key shown only with `sys.inputs.showAnswers`, callouts, rubrics, student fields, number lines, graph paper, coordinate planes and chemistry (`ce`). Every function renders in the paged and HTML targets and in English, Arabic and Bengali. Packaged as a `TypstreamPlugin` with CSS and a prompt catalogue generated from the doc comments.
- 913c0bc: edu's components are what Word can draw, so a DOCX export can match the pages (#130). Callouts and instructions are
  square frames with the title on the first line (the title sat on a rounded frame's border) and don't break across
  pages; a shown correct option is bold instead of circled; the answer reveal has no inset above or below; answer lines
  are one ruled line per block, kept together, and a shown answer is set at their pitch with the remaining lines ruled
  below it; MCQ options are one grid whose rows, like true/false's and matching's, don't break; a rubric cell with a word
  too wide for its column is set smaller instead of hyphenated; sizes relative to the text are rounded to half points.
  The HTML target follows the new callout and marker.
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
- fdb250d: Prompt kit measured on real models (#24). `@typstream/edu`: `buildSystemPrompt(plugins)` writes the system prompt from the plugins' rules, catalogue and examples, and `typstPromptRules` adds the Typst habits models get wrong (scripts without a base, multi-letter math names, bare math as arguments, `*/` and `/ ` in markup, imports for packages); `mcq`'s example shows math options. `@typstream/heal`: new `math-lone-script` lint fix (`m/s$^2$` → `m/s$""^2$`), and `currency-dollar` no longer warns on math such as `$0.4 times 0.3 =$` or `$30 degree$`. `@typstream/universe`: CeTZ's prompt line shows its own shapes.

### Patch Changes

- 3827c1c: DOCX exports match the page more closely (#135): a blank's underline keeps the colour of the line Typst draws
  (`underlineColor` on text and gap runs) and stays underlined at the start or end of a paragraph; a shown answer is a
  paragraph of its own under its question; an inline equation broken over two lines comes after the text before it;
  a table that ends on a later page keeps its borders and height there; answer lines in a table row split across pages
  are kept. edu draws a blank's line where Word underlines (0.078em below the baseline), keeps a blank alone in a cell on
  a text line, and puts a student field's line at the bottom of its label's line.
- df49100: `rubric` on paper: a word wider than its column ("Counterargument" in a five-level rubric) no longer runs into the next column. Typst breaks lines only at spaces unless it may hyphenate, so a cell with such a word is now hyphenated; cells whose words fit keep their line breaks.
- 0d39735: `student-info` on paper (the name, date and class lines under a template's title): each line now sits just under its label's baseline, as a `blank`'s line does in a sentence. The header is a grid with labels and lines in cells of their own; a line's cell holds no text, so with the cells aligned at the top the lines came out level with the middle of the labels, in every language. The cells now align at the bottom, where a text line's frame ends at its baseline. HTML output was already right.
- 558108b: `place()` in the HTML target positions inside its container's `inset`, as Typst does, instead of against the padding box (#94). Blocks, boxes and shapes write their inset per side as custom properties (`--ts-inset-left`, …) that `place`'s offsets read; the stylesheet resets them on every element a placed piece can be positioned against, so nested containers each use their own. Placed text with a vertical alignment gets Typst's text box, cap height to baseline (`text-box: trim-both cap alphabetic`), so a label offset from a shape's edge lands where paged output puts it. All alignments, `dx`/`dy` and per-side insets match the paged layout within 1.5pt. edu's callouts set the same properties to their padding.
- Updated dependencies [3e66075]
- Updated dependencies [12ea537]
- Updated dependencies [ba56f2e]
- Updated dependencies [ec38329]
- Updated dependencies [69f1477]
- Updated dependencies [b4d7bed]
- Updated dependencies [813029f]
- Updated dependencies [cbb44d9]
- Updated dependencies [ba77608]
- Updated dependencies [41ae15f]
- Updated dependencies [4ad0ae1]
- Updated dependencies [8184b0f]
- Updated dependencies [466147c]
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [e6c5a7b]
- Updated dependencies [3a11cdc]
- Updated dependencies [5275321]
- Updated dependencies [c620668]
- Updated dependencies [0d1c1c3]
  - @typstream/core@0.1.0
