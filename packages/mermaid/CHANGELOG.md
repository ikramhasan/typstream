# @typstream/mermaid

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/core@0.1.1

## 0.1.0

### Minor Changes

- d54927d: File generators (beta): plugin code in the engine's worker that makes files from a document's source before every compile and export, for what Typst can't compute itself. core adds `FileGenerator` and `DocumentFileGenerator`, the plugin facet `engine.generatorModules` (ES module URLs, like `fixerModules`) and `document/open`'s `generatorModules`. The engine's server imports a document's generator modules once each, runs them on its preamble and text, and writes only the files that changed (removing those no longer returned); `ServerOptions.generators` (also in `serve` and `inProcess`) are a server's own, which run even when `clientFixers: false` ignores the client's modules.
  
  New package `@typstream/mermaid`: Mermaid diagrams drawn by [pele](https://pele.run). A model writes a ```` ```mermaid ```` raw block; the worker draws it with pele (the generator module, `MERMAID_GENERATOR`, about 276 KB gzipped, never on the main thread) and the plugin's Typst shows the shapes as an SVG image and the labels as Typst text in the fonts pele measured them in, so a diagram is the same on pages, in the HTML target, the PDF and a DOCX export. Diagrams too wide for the page are laid out again for its width; while streaming a block keeps its last drawing; final mode shows pele's error. With its prompt kit; `@typstream/mermaid/generator` gives servers and custom workers the generator itself.
  
  The worker's imports of fixer and generator modules are marked for bundlers to leave alone (`webpackIgnore`, `turbopackIgnore`): Turbopack replaced them with a "module not found" error, so in a Next.js app no plugin's worker module loaded.
  
  The prompt rules teach Sankey diagrams' syntax (`sankey-beta`, CSV with no header row: pele rejects a header's "Value" as a number).

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
