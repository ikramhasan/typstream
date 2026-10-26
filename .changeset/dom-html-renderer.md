---
"@typstream/dom": minor
"@typstream/engine": minor
---

The HTML renderer (#16). `@typstream/dom` (new) renders the engine's HTML artifacts with `createHtmlRenderer(root)`: it splits each artifact into top-level blocks, parses and sanitizes only the blocks that changed (an allowlist sanitizer that keeps MathML and frame SVG and prefixes ids per document), fades in new words, shows an optional caret, and themes with CSS variables. The engine server now inserts source anchors into HTML compiles (`compile.anchors`, default true; paged compiles and exports have none), which the renderer turns into `data-typstream-src` on blocks and resolves with `sourceRange(node)` / `blockAt(offset)`.
