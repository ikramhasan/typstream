---
"@typstream/engine-wasm": minor
"@typstream/engine": minor
"@typstream/node": patch
---

Every engine chooses from the same font faces (#128). engine-wasm ships all 17 faces of Typst's bundled fonts with
TrueType outlines: the base fonts now have New Computer Modern Math's Book face, the one Typst sets math in (it had
Regular, so equations in the browser were lighter than native typst drew them), and the other 12 faces (Libertinus Serif
bold italic and semibold, New Computer Modern, the math font's regular and bold, DejaVu Sans Mono bold and oblique) are
the new `extraFonts`, which the default worker registers lazily. `@typstream/node` serves the same files.
