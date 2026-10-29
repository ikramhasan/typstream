---
"@typstream/docx": minor
"@typstream/engine": minor
"@typstream/engine-wasm": minor
---

DOCX exports write equations as editable Word equations (OMML) instead of empty space (#132): fractions, scripts and
limits, roots, brackets, matrices and `cases`, big operators and function names with their operands, accents, braces
and aligned lines, inline in their line or displayed (a numbered one with its number at the right), in Typst's math
font. engine-wasm reads them from Typst's own math layout's first step during the export's compile. The layout profile
now keeps Typst's default spacing between the lines of a display equation with line breaks (the profile's `leading: 0`
made them touch).

DOCX exports also number pages as Typst does (roman numerals, a restart after the front matter: Word sections), write
outlines with Word's dot leaders, keep a centred table's columns and borders, and keep answer lines apart.
