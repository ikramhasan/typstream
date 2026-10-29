---
"@typstream/docx": minor
"@typstream/engine-wasm": patch
"@typstream/edu": patch
---

DOCX exports match the page more closely (#135): a blank's underline keeps the colour of the line Typst draws
(`underlineColor` on text and gap runs) and stays underlined at the start or end of a paragraph; a shown answer is a
paragraph of its own under its question; an inline equation broken over two lines comes after the text before it;
a table that ends on a later page keeps its borders and height there; answer lines in a table row split across pages
are kept. edu draws a blank's line where Word underlines (0.078em below the baseline), keeps a blank alone in a cell on
a text line, and puts a student field's line at the bottom of its label's line.
