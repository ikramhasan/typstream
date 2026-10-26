---
"@typstream/heal": patch
"@typstream/dom": patch
"@typstream/html-compat": patch
---

Fixes found by the corpus-wide browser suites (#19). heal closes a cut display equation with a space (`$ a + b` heals to `$ a + b $`, not the inline `$ a + b$`), so a streamed equation no longer flips between display and inline. The HTML renderer sets `lang` and `dir` on its root from the document's language (Typst writes `lang` on `<html>` and no direction), so right-to-left documents render right to left; keeps the light theme's colours inside what the document filled (boxes, table cells, code blocks), which the dark theme made light on light; and no longer takes a document that so far is one `<div>` for a template wrapper, which rebuilt the page twice. The paged renderer doesn't redraw a page whose SVG is unchanged under a new hash (Typst's frame hashes include source spans). html-compat hides drawings without text from assistive technology instead of exposing them as images without a name.
