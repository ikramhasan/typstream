---
"@typstream/dom": patch
"@typstream/core": patch
---

The HTML sanitizer now honours a plugin's `sanitize.allowAttrs["*"]`: those attributes are kept on every HTML element (not SVG or MathML), still without event handlers or loading attributes, and never `href`, `src` or `xlink:href` (allow those by tag). An allowed `name` gets the renderer's id prefix, like `id`.
