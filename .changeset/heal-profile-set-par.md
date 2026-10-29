---
"@typstream/heal": patch
---

The `layout-profile` lint also takes `leading`, `justify` and `linebreaks` out of `set par(…)` rules, and out of any
show-set rule that sets `par`. Typst sets text with no blocks around it (a tight list's items, a table cell's, a box's)
without a `par` element, which the layout profile's show rule doesn't reach, so a document's `#set par(leading: 0.75em)`
still spaced those lines apart in pages, PDFs and DOCX exports (#131).
