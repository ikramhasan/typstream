---
"@typstream/docx": minor
"@typstream/engine": minor
"@typstream/engine-wasm": minor
"@typstream/node": minor
"@typstream/edu": minor
---

DOCX exports draw what Word can't express as pictures instead of empty space (#133): images, CeTZ and fletcher
canvases, mind maps, edu's number lines, graph paper and coordinate planes (their descriptions as alt text), and
boxes with rounded corners, each as Typst drew it, at its size and place: SVG from typst-svg, which Word 2016 and later,
LibreOffice and ONLYOFFICE draw, with a 300 DPI PNG for older Word and other apps, rendered in the wasm (typst-render's
rasterizer, vendored without PDF images). A `place`d drawing is anchored to the page. Free-form content a picture
holds (a box with rounded corners, rotated text) is a `docx/fallback` warning, and edu's prompt kit steers models to
its callouts instead.

DOCX exports also write Typst's `super` and `sub` (set with the font's own glyphs) as Word's superscript and subscript,
keep the label of a list item that starts with a table, and keep an inline equation in a list inside a block (its Word
math was dropped when a fraction made its line look wrapped).
