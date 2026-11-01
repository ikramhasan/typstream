---
"@typstream/docx": patch
"@typstream/engine-wasm": patch
---

DOCX exports open in Apple's Pages closer to the page: Pages reads no cell margins (its cells' text is 4 points in from each side), so a cell's margins past that are its paragraphs' indents, and a column whose one-line cells Pages would wrap takes room from the cell before it, which Word sees as wider margins; each row has the height Typst gave it less its margins and borders, at least (engine-wasm's model records each row's `height` and each cell paragraph's `room`); and the gap above a table is a paragraph of its own, as Pages sets a table in a paragraph made like the one before it (its spacing, page break and keep with next). Each change keeps what Word sets where it was; LibreOffice lays the files out as before.
