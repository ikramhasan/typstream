---
"@typstream/docx": patch
"@typstream/engine-wasm": patch
"@typstream/engine": patch
"@typstream/heal": patch
---

DOCX exports keep what the page shows where they lost it while their lines still matched (#118). An answer line under
a callout in a question is no longer dropped (LibreOffice drops an empty paragraph after a table at a cell's end); an
equation ending in an operator (`$1/5 + 2/5 =$`) no longer shows LibreOffice's red "¿"; a blank that is a list item's
whole body (`1. #box(stroke: (bottom: …))` in a table cell), a term's or a line's first stays on its line, underlined;
a list item's number Typst kept at the left of a centred cell stays there; a line a `\` broke where Typst would have
broken anyway keeps its break, an empty line between such lines its room, and a line after one starting with `h()`
its room; a code block's lines and right-aligned or centred lines no longer wrap in Word, and centred and
right-aligned lines are centred and right-aligned paragraphs; list numbers keep their labels' face, size and colour
(not a bold first word's); a list starting at "v." is numbered in Roman numerals. Highlights and filled boxes around
words are Word's shading (in their colour as it shows on paper: `highlight`'s yellow is translucent), strikethrough is
Word's, dashed and dotted frames have Word's dashed and dotted borders, a dashed line is a picture, and a gradient is a
picture whose SVG LibreOffice draws (typst-svg's referencing gradients are flattened).

The layout profile turns hanging punctuation off (`overhang: false`), as Word has none. Heal's `layout-profile` lint
rule takes `radius` out of `block`, `rect` and `box` calls that hold content and out of their set rules: a box with
rounded corners around text was a picture in a DOCX export, its text not editable; a square one is a table cell.
