---
"@typstream/engine-wasm": patch
"@typstream/engine": patch
"@typstream/node": patch
---

Devanagari text with no font set renders in Noto Serif Devanagari, with its shaping, instead of New Computer Modern Math (#80). Typst's fallback picked the math font, which also covers Devanagari, because it is more like Libertinus Serif by Typst's measure. A math font is no longer a fallback for the letters of scripts other than Latin and Greek; its symbols and math alphabets still are, and equations, Arabic and Bengali render as before.
