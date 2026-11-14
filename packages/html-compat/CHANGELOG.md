# @typstream/html-compat

## 0.1.0

### Minor Changes

- 3e66075: Plugins load through one system (#27, PLAN §8.0). `resolvePlugins` (core) loads each key once (its last definition), puts every plugin after its dependencies and otherwise keeps the given order, and rejects missing dependencies and cycles; facets it doesn't know are ignored. `createEngine({ plugins })` sends plugins' fonts, packages and fixer modules with `initialize`; `engine.open({ plugins })` resolves a document's plugins (`EngineDocument.plugins`) and applies their files, packages, preambles, heal handlers and lint settings, and fixer modules, which the worker now loads per document (`document/open`'s `fixerModules`; one that fails to load is logged and skipped). Plugins have a `stylesheets` facet, which the HTML renderer, `standaloneHtml` (new `plugins` option) and `mountTypstream` apply: html-compat and edu carry their CSS in it, so `plugins: [htmlCompat]` is enough and `typstream` no longer adds `htmlCompatCss` separately.
  
  Security: the engine server's new `clientFixers` option (default true) decides whether it imports the fixer modules a client names. `@typstream/node`'s protocol server sets it to false: it already treated clients as untrusted for packages, but still imported `initialize`'s `fixerModules`, which let a client run code in the server (a `data:` module URL).
- ec38329: A document in the HTML target stays inside its element (#69). The renderer's stylesheet clips its root (`position: relative; overflow: clip; clip-path: inset(0)` on `.typstream`), so nothing the document draws, or the page's CSS gives it, paints or takes clicks outside the element: not a viewport-sized `position: absolute` box, a `transform`, negative margins, nor a `position: fixed` that a page class applies. Layout doesn't change (no new formatting context); what reached past the element, such as a table wider than it, is now cut off. The sanitizer keeps only the classes Typst writes, the engine's `typstream-*` placeholders and the ones plugins list in the new `sanitize.allowClasses` facet (names, or prefixes like `"ts-*"`), so a document can no longer take on the page's own classes (Tailwind's `fixed inset-0 z-50`, an app's buttons). html-compat allows `ts-*` and edu `edu-*`; a plugin whose Typst writes classes for its stylesheet must list them.
- a6cff6a: New package: a Typst prelude and CSS that make Typst 0.15.1's HTML export keep the content it drops (grid, align, block and box styling, shapes, stack, columns, place, pad, spacing, transforms, layout), draw what HTML can't express as inline SVG, and number block equations (#15). Paged output is unchanged.
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

### Patch Changes

- ea04dbd: Fixes found by the corpus-wide browser suites (#19). heal closes a cut display equation with a space (`$ a + b` heals to `$ a + b $`, not the inline `$ a + b$`), so a streamed equation no longer flips between display and inline. The HTML renderer sets `lang` and `dir` on its root from the document's language (Typst writes `lang` on `<html>` and no direction), so right-to-left documents render right to left; keeps the light theme's colours inside what the document filled (boxes, table cells, code blocks), which the dark theme made light on light; and no longer takes a document that so far is one `<div>` for a template wrapper, which rebuilt the page twice. The paged renderer doesn't redraw a page whose SVG is unchanged under a new hash (Typst's frame hashes include source spans). html-compat hides drawings without text from assistive technology instead of exposing them as images without a name.
- 4a2981f: Dark theme: text `place`d inside a filled area (a flashcard's corner label) takes the fill's light-theme colours instead of the page's, which made it light on light (#64). html-compat marks a placement that points outward from its anchoring edge (`bottom` with a positive `dy`, `right` with a positive `dx`, …) with `ts-place-out`, and only those keep the page's theme, so a shape's dimension labels drawn beside it stay readable.
- fd3292c: In the HTML target, a table, an equation or a code block wider than its element scrolls sideways inside it instead of being cut off (#95). Once a render is laid out, and again when the element's size changes, the renderer marks the boxes that are too wide: code scrolls itself, a table or a display equation scrolls in a `div` the renderer puts around it (Firefox and WebKit can't scroll a `math` element). The marked box has `data-typstream-wide` and `tabindex="0"`, so the keyboard can scroll it too. Only those boxes change: a document that fits is laid out as before, and the page never scrolls sideways. Display equations are now as wide as their content, so a wide one is measured the same in every browser. html-compat's `repeat` now stops at the edge of its box (or line), as in Typst, instead of spilling past it.
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
