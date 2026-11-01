---
"@typstream/core": minor
"@typstream/dom": minor
"@typstream/html-compat": minor
"@typstream/edu": minor
"@typstream/engine": minor
"@typstream/react": minor
"typstream": minor
"@typstream/node": patch
---

The HTML target looks like the pages. Switching a document between the HTML and paged targets no longer changes how it looks: the same fonts, sizes, line breaks, spacing and page breaks.

- **engine, node**: the layout profile now goes before HTML compiles too, so html-compat reads the same text edges, paragraph and heading spacing and table insets as the pages use. A source anchor goes past the set and show rules its block starts with, and a block of rules only gets none. Under html-compat, the error block of a part that doesn't compile is laid out as on pages. HTML compiles send each glyph outline of Typst's pictures (`html.frame`) once, where it first appears, instead of in every picture. An HTML export can keep the source anchors (`ExportOptions.anchors`, `ExportParams.anchors` in core's protocol), on which html-compat writes the page settings, header and footer, to be laid out as pages.
- **dom**: the HTML renderer lays the document out on pages (`.typstream-pages`). It uses the page size and margins html-compat writes, scales them as the paged view does (the new `layout` option), and breaks across them where Typst would: orphans and widows, table rows, unbreakable and sticky blocks, forced and weak page breaks. Headers and footers go on every sheet with its page number, footnotes at the foot of their page, and a table's header again on each page it goes on to. Page settings that change mid-document start a page with their numbering, header and footer, `counter(page).update` renumbers the pages, inside and outside margins swap on even pages, and page columns fill one after the other. The page count comes back to the document as the input `typstream-page-count` (the new `onPages` option). Columns fill as Typst's do. Fractional spacing (`v(1fr)`, `h(1fr)`) takes what its page or line leaves, and aligned blocks sit in the room their page leaves. The renderer lays out again when the width changes or fonts load. `registerTypstFonts` (with `TypstFont`, and the `fonts` option of `mountTypstream` and `<Typstream>`) registers Typst's fonts with the profile's line box, so lines are as tall as Typst's and baselines sit where Typst puts them. Blocks that start in the source get `data-typstream-start`. The wide-block scrolling (`data-typstream-wide`) is gone: the pages scale to the element instead. `standalonePages` (with `StandalonePagesOptions`) makes an HTML export a file laid out as the pages, with the Typst fonts it uses embedded; `MountedTypstream.exportHtml()` uses it (`TypstreamHtmlExportOptions`; `pages: false` for the reading layout of `standaloneHtml`), exporting with the anchors and again with the page count it was laid out on (`StandalonePagesOptions.onPages`) until the count holds. The view's own page count feeds back to the document a few times per source and inputs at most, so a document whose length depends on it can't keep the engine compiling. Headers, footers, footnotes and split boxes are clipped to the pages like the rest of the document. Glyph outlines are kept once each in the root (`.typstream-glyphs`), and equation pictures that come again are copied rather than parsed again.
- **html-compat**: it now emits Typst's layout for the HTML target in place of browser defaults:
  - lengths resolved as Typst resolves them, and text sizes on blocks and paragraphs;
  - strokes drawn on the edge, grids and tables placed as Typst places their cells (ARIA roles kept), lists with their marker column;
  - spacing that collapses as Typst's (weak, strong, `v`, attached tight lists, a list after a blank line);
  - first-line indents, aligned text as aligned paragraphs, boxes on their baselines;
  - inline equations broken where Typst breaks them and sitting in their lines, display equations with numbers;
  - outlines with page numbers, page geometry, headers and footers.

  In paged compiles html-compat does nothing.
- **edu**: one code path for both targets (no HTML branches); it now depends on html-compat.
- **typstream**: `<Typstream>` registers the engine's fonts for the HTML target.
