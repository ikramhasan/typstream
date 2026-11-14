# @typstream/google-fonts

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/core@0.1.1

## 0.1.0

### Minor Changes

- 466147c: Font catalogues, and `@typstream/google-fonts`: documents can use any Google Fonts family by name (`#set text(font: "Lora")`). A catalogue (`FontCatalogue`, plugins' `engine.fontCatalogues`, also from a document's plugins) is an index of families and their font files; when a compile names a family the engine doesn't have, the worker looks it up, loads its files (`EngineAdapter.addFonts`) and compiles the document again, and announces it (`fonts/loaded`, `Engine.fonts`, the `font` event). In the HTML target, google-fonts' preamble marks text in another font with its family, and `mountTypstream` shows the families the engine loaded as web fonts made from the same files (`registerLoadedFont`); `standaloneHtml({ fonts })` links them. `@typstream/node`'s server ignores clients' catalogues.

### Patch Changes

- Updated dependencies [3e66075]
- Updated dependencies [12ea537]
- Updated dependencies [ba56f2e]
- Updated dependencies [ec38329]
- Updated dependencies [69f1477]
- Updated dependencies [b4d7bed]
- Updated dependencies [813029f]
- Updated dependencies [cbb44d9]
- Updated dependencies [ba77608]
- Updated dependencies [41ae15f]
- Updated dependencies [4ad0ae1]
- Updated dependencies [8184b0f]
- Updated dependencies [466147c]
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [e6c5a7b]
- Updated dependencies [3a11cdc]
- Updated dependencies [5275321]
- Updated dependencies [c620668]
- Updated dependencies [0d1c1c3]
  - @typstream/core@0.1.0
