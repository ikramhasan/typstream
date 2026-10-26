---
"@typstream/engine-wasm": minor
"@typstream/engine": minor
"@typstream/core": minor
"@typstream/node": minor
"@typstream/dom": patch
---

Lazy fonts (#11). Arabic, Bengali and Devanagari render with their own fonts (Noto Naskh Arabic, Noto Serif Bengali, Noto Serif Devanagari, regular and bold), downloaded by the engine worker only when a document uses them. engine-wasm's fonts now belong to the wasm instance, shared by every `Engine` (`Engine.add_font` is static), and can be registered before their bytes arrive: `Engine.font_info(bytes)` gives a file's metadata, `Engine.register_font(info)` puts its faces in the font book, `Engine.load_font(id, bytes)` gives them their bytes, and every compile lists the fonts it wanted but lacked in `missingFonts`. `@typstream/engine-wasm/fonts` exports `scriptFonts` next to `baseFonts`. The engine-wasm adapter takes `lazyFonts` and `fontCache` (Cache Storage, default `"typstream-fonts"`, which base fonts use too), and the default worker registers `scriptFonts`. An adapter compile can return `pending`: the server recompiles the document on its own once it resolves, and exports wait for it. `FontSource.info` makes an app's own font lazy. `@typstream/node` loads the script fonts up front (`scriptFonts: false` to leave them out). The HTML renderer's theme gives each paragraph the direction of its text (`unicode-bidi: plaintext`), since Typst's HTML export doesn't mark right-to-left text.
