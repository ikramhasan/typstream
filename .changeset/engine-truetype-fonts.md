---
"@typstream/engine-wasm": minor
"@typstream/node": patch
"@typstream/dom": patch
---

The base fonts have TrueType outlines (#118): the build converts Libertinus Serif and New Computer Modern Math, which
typst-assets ships with CFF outlines that Word won't embed, so the paged view, the PDF and a DOCX can use the same
files. They lay out the same. The files are renamed: `dist/fonts/LibertinusSerif-{Regular,Bold,Italic}.ttf` and
`NewCMMath-Regular.ttf` (were `.otf`); `baseFonts` has the new URLs. `@typstream/node` serves the same conversions, and
`standaloneHtml` labels an embedded math font with its actual media type.
