---
"@typstream/docx": patch
"@typstream/engine-wasm": patch
---

DOCX exports draw rules, borders and blanks where the page does (#118): a blank drawn as a box stroked underneath
(on the baseline) is raised or lowered so Word's underline lands on Typst's line (`raise` on gap runs, from the font's
underline position), and keeps its underline next to `h(1fr)`; a blank alone in its paragraph sits on its line; a
`line` in a list no longer pushes what follows down by half its stroke; a table going on to another page keeps its
cells' side borders there (its strokes there start just above the top margin, and were taken for the header's); a box
holding boxes takes its insets from them, not from their text; columns under a float keep the room above them; a
block Typst moves to the next page whole in a table cell (answer lines under a question) leaves the room it left on
the page before (a breakable spacer, `breakable` on drawings) and its gap from the new page's top. A box stroked on its
sides in a line (a checkbox) is a picture, anchored to its line where Typst lowered it below the baseline (`line` on a
picture in a line), since LibreOffice won't lower a drawing in the line.
