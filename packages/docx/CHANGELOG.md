# @typstream/docx

## 0.2.0

No changes in this release.

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.

## 0.1.0

### Minor Changes

- 3827c1c: DOCX exports match the page more closely (#135): a blank's underline keeps the colour of the line Typst draws
  (`underlineColor` on text and gap runs) and stays underlined at the start or end of a paragraph; a shown answer is a
  paragraph of its own under its question; an inline equation broken over two lines comes after the text before it;
  a table that ends on a later page keeps its borders and height there; answer lines in a table row split across pages
  are kept. edu draws a blank's line where Word underlines (0.078em below the baseline), keeps a blank alone in a cell on
  a text line, and puts a student field's line at the bottom of its label's line.
- 5fa30b6: DOCX exports write equations as editable Word equations (OMML) instead of empty space (#132): fractions, scripts and
  limits, roots, brackets, matrices and `cases`, big operators and function names with their operands, accents, braces
  and aligned lines, inline in their line or displayed (a numbered one with its number at the right), in Typst's math
  font. engine-wasm reads them from Typst's own math layout's first step during the export's compile. The layout profile
  now keeps Typst's default spacing between the lines of a display equation with line breaks (the profile's `leading: 0`
  made them touch).
  
  DOCX exports also number pages as Typst does (roman numerals, a restart after the front matter: Word sections), write
  outlines with Word's dot leaders, keep a centred table's columns and borders, and keep answer lines apart.
- ba56f2e: DOCX export (beta, #131): `exportDocx()` on `EngineDocument`, `MountedTypstream`, `<Typstream>`'s handle and
  `useTypstream()`, and `render(source, "docx")` in `@typstream/node`, give an editable Word file that lays out as the
  PDF does: paragraphs and runs, headings, lists with Word numbering, tables and grids with Typst's column widths,
  framed boxes, columns (Word sections), placed text (frames at its page position), header rows Typst repeats, page
  breaks where Typst starts a page, headers and footers with page-number fields, Typst's fonts embedded, under the
  layout profile.
  engine-wasm reads the laid-out pages into a document model (`compile_docx_model`, `docx_margin_probe`); the new
  `@typstream/docx` writes the file, loaded by the engine's worker on the first DOCX export. The protocol's
  `ExportFormat` gains `docx` (`export/docx`). Equations, images and drawings hold their place as empty space for now.
  `@typstream/node`'s protocol server no longer applies the layout profile twice.
- 6cc1c5b: DOCX exports draw what Word can't express as pictures instead of empty space (#133): images, CeTZ and fletcher
  canvases, mind maps, edu's number lines, graph paper and coordinate planes (their descriptions as alt text), and
  boxes with rounded corners, each as Typst drew it, at its size and place: SVG from typst-svg, which Word 2016 and later,
  LibreOffice and ONLYOFFICE draw, with a 300 DPI PNG for older Word and other apps, rendered in the wasm (typst-render's
  rasterizer, vendored without PDF images). A `place`d drawing is anchored to the page. Free-form content a picture
  holds (a box with rounded corners, rotated text) is a `docx/fallback` warning, and edu's prompt kit steers models to
  its callouts instead.
  
  DOCX exports also write Typst's `super` and `sub` (set with the font's own glyphs) as Word's superscript and subscript,
  keep the label of a list item that starts with a table, and keep an inline equation in a list inside a block (its Word
  math was dropped when a fraction made its line look wrapped).
- 5f49264: DOCX exports in other scripts (#134): Arabic and Hebrew right to left (`w:bidi` paragraphs with mirrored alignment,
  indents, lists and tables, `w:rtl` runs), Bengali and Devanagari text written once though Typst draws vowel signs
  apart, each run with its language, Word's Hindi numbers for Devanagari page numbers, and gaps among complex-script
  text that ONLYOFFICE keeps. Also: short lines between paragraphs, centred floats in columns, and paragraphs whose text
  size changes between lines.

### Patch Changes

- 28374ec: DOCX exports keep what the page shows where they lost it while their lines still matched (#118). An answer line under
  a callout in a question is no longer dropped (LibreOffice drops an empty paragraph after a table at a cell's end); an
  equation starting or ending in an operator (`$1/5 + 2/5 =$`, an aligned equation's `&= 22`) or with absolute-value
  bars no longer shows LibreOffice's red "¿", and an equation that is only an operator (`$->$`) is set without spacing;
  a blank that is a list item's whole body (`1. #box(stroke: (bottom: …))` in a table cell), a term's or a line's first
  stays on its line, underlined; a list item's number Typst kept at the left of a centred cell stays there; a line a `\`
  broke where Typst would have broken anyway keeps its break, an empty line between such lines its room, and a line
  after one starting with `h()` its room; a code block's lines and right-aligned or centred lines no longer wrap in
  Word, and centred and right-aligned lines are centred and right-aligned paragraphs; list numbers keep their labels'
  face, size and colour (not a bold first word's); a list starting at "v." is numbered in Roman numerals. Highlights and
  filled boxes around words are Word's shading (in their colour as it shows on paper: `highlight`'s yellow is
  translucent), strikethrough is Word's, dashed and dotted frames have Word's dashed and dotted borders, a dashed line
  is a picture, and a gradient is a picture whose SVG LibreOffice draws (typst-svg's referencing gradients are
  flattened).
  
  The layout profile turns hanging punctuation off (`overhang: false`), as Word has none. Heal's `layout-profile` lint
  rule takes a small fixed `radius` (a text box's, up to 12 pt) out of `block`, `rect` and `box` calls that hold content
  and out of their set rules: a box with rounded corners around text was a picture in a DOCX export, its text not
  editable; a square one is a table cell. A ratio or a larger radius draws a shape, which stays as it is.
- 193687a: DOCX exports keep a drawing's room in Google Docs: a CeTZ canvas, image or other picture in a line of its own is now
  a character in a single-spaced line as tall as it, instead of anchored in front of the text over an exact-height
  paragraph. Google Docs has no exact line heights, so that paragraph shrank to a fraction of the picture and the text
  after it ran under it. Word, LibreOffice and ONLYOFFICE lay it out as before. A picture that starts left of its
  container, or reaches past its room by more than the space above it, is still anchored.
- 3edcd4d: DOCX exports keep the room of an anchored drawing, and of other space held by an empty paragraph, in Google Docs. Google
  Docs has no exact line heights and sized those paragraphs from their point-tall font, so a box as wide as its cell, a
  code block or a rounded box with text held a fifth of its height there and covered the text after it, and a room that
  breaks between pages kept three quarters of it. Their mark is now Arial at the size whose line Google Docs makes the
  height (10.5 pt for a line of 0.72 pt or more, smaller below that, where Google Docs keeps at least 0.06 of a line);
  Word, LibreOffice and ONLYOFFICE lay the file out as before.
- c14509b: DOCX exports draw rules, borders and blanks where the page does (#118): a blank drawn as a box stroked underneath
  (on the baseline) is raised or lowered so Word's underline lands on Typst's line (`raise` on gap runs, from the font's
  underline position), and keeps its underline next to `h(1fr)`; a blank alone in its paragraph sits on its line; a
  `line` in a list no longer pushes what follows down by half its stroke; a table going on to another page keeps its
  cells' side borders there (its strokes there start just above the top margin, and were taken for the header's); a box
  holding boxes takes its insets from them, not from their text; columns under a float keep the room above them; a
  block Typst moves to the next page whole in a table cell (answer lines under a question) leaves the room it left on
  the page before (a breakable spacer, `breakable` on drawings) and its gap from the new page's top. A box stroked on its
  sides in a line (a checkbox) is a picture, anchored to its line where Typst lowered it below the baseline (`line` on a
  picture in a line), since LibreOffice won't lower a drawing in the line.
- feba233: DOCX exports open in Apple's Pages closer to the page: Pages reads no cell margins (its cells' text is 4 points in from each side), so a cell's margins past that are its paragraphs' indents, and a column whose one-line cells Pages would wrap takes room from the cell before it, which Word sees as wider margins; each row has the height Typst gave it less its margins and borders, at least (engine-wasm's model records each row's `height` and each cell paragraph's `room`); and the gap above a table is a paragraph of its own, as Pages sets a table in a paragraph made like the one before it (its spacing, page break and keep with next). Each change keeps what Word sets where it was; LibreOffice lays the files out as before.
