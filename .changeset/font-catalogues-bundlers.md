---
"@typstream/engine": patch
"@typstream/dom": patch
---

Font catalogues work in a bundled app. The worker resolves an index's `base` against the URL the index came from, so an index at a root-relative URL loads its families: bundlers emit `new URL("…", import.meta.url)` as one (Turbopack's `/_next/static/media/…`), and `@typstream/google-fonts` loaded no family under Next.js. In the HTML target, a loaded family's web font is named as an identifier (`typstream-lora`, was `"typstream Lora"`): Chrome's FontFace kept the quotes in the name, so no text showed in the family there.
