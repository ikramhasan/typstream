---
"@typstream/engine-wasm": patch
---

DOCX pictures inline the SVG images they hold. An SVG image (a Mermaid diagram's shapes) was a data-URL `<image>` inside the picture's SVG, which LibreOffice 26.2 draws with some strokes a fraction of a point off (round-capped lines and dashes); it is now a nested `<svg>` of the image's box with the image's content, its ids prefixed, which LibreOffice draws as Typst's PDF has it. Images with a doctype or a style sheet (whose selectors would then apply to the whole picture), and raster images, stay as they are.
