---
"@typstream/docx": minor
"@typstream/engine-wasm": minor
---

DOCX exports in other scripts (#134): Arabic and Hebrew right to left (`w:bidi` paragraphs with mirrored alignment,
indents, lists and tables, `w:rtl` runs), Bengali and Devanagari text written once though Typst draws vowel signs
apart, each run with its language, Word's Hindi numbers for Devanagari page numbers, and gaps among complex-script
text that ONLYOFFICE keeps. Also: short lines between paragraphs, centred floats in columns, and paragraphs whose text
size changes between lines.
