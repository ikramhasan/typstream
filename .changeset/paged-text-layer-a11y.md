---
"@typstream/core": minor
"@typstream/dom": minor
---

The paged text layer has the document's structure, language and direction (#63). Each page now carries its headings, lists and tables (`PageUpdate.structure`, `TextNode`), the document's `lang` and `dir`, and each run's own `lang`/`dir` where they differ. The layer wraps the runs in inline spans with ARIA roles (`heading` with `aria-level` as in the HTML target, `list`/`listitem`, `table`/`row`/`cell`/`columnheader`), so screen readers can move between headings and through tables. Copying, selection and find-in-page are unchanged. Spaces and line breaks follow the text's direction, so right-to-left lines copy and read in order. Offscreen pages skip their SVG but no longer their text layer, which `content-visibility: auto` had taken out of the accessibility tree. A page whose text layer changes under an unchanged SVG is now redrawn. `standaloneHtml` sets `dir="rtl"` on right-to-left documents.

engine-wasm's text runs are now in reading order and whole: Typst splits a shaped run at every font or vertical-offset change, so an Arabic word (its dots are offset marks) came out as pieces in visual order with each mark repeating its letter. Marks are dropped and touching pieces joined, right to left for RTL text.
