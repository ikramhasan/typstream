---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/dom": minor
"@typstream/node": patch
"@typstream/google-fonts": minor
---

Font catalogues, and `@typstream/google-fonts`: documents can use any Google Fonts family by name (`#set text(font: "Lora")`). A catalogue (`FontCatalogue`, plugins' `engine.fontCatalogues`, also from a document's plugins) is an index of families and their font files; when a compile names a family the engine doesn't have, the worker looks it up, loads its files (`EngineAdapter.addFonts`) and compiles the document again, and announces it (`fonts/loaded`, `Engine.fonts`, the `font` event). In the HTML target, google-fonts' preamble marks text in another font with its family, and `mountTypstream` shows the families the engine loaded as web fonts made from the same files (`registerLoadedFont`); `standaloneHtml({ fonts })` links them. `@typstream/node`'s server ignores clients' catalogues.
