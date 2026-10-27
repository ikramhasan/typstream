---
"@typstream/edu": patch
---

`rubric` on paper: a word wider than its column ("Counterargument" in a five-level rubric) no longer runs into the next column. Typst breaks lines only at spaces unless it may hyphenate, so a cell with such a word is now hyphenated; cells whose words fit keep their line breaks.
