# @typstream/mindmap

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/core@0.1.1

## 0.1.0

### Minor Changes

- 5275321: Render islands (#28, beta): interactive components mounted over markers a document's Typst writes around its own fallback drawing, which is what prints, exports and shows wherever nothing mounts. core settles the contract: `ISLAND_MARKER`, `IslandSpec { description, parse }` in the plugin's `islands` facet, `IslandProps`, and `PagedIsland` on `PagedArtifact.islands`. engine-wasm finds the paged target's island markers in each laid-out document (page, position, value, source offset), and the engine sends them with every paged artifact; `EngineDocument.file(path)` gives islands the bytes a document has. dom's HTML renderer and `mountTypstream` take `islands`, framework-free renderers by name, and keep one mounted island per marker while its block streams; `@typstream/react`'s `islands` prop renders React components into them through portals. The paged view's overlay follows the canvas pages (#14).
  
  New package `@typstream/mindmap`, the first island: mind maps written as a list (`#mindmap[…]`, `#topic(…)` for a node's colour, size, weight, image or collapsed branches, `text-focused` and one-sided styles), drawn in plain Typst, with its prompt kit; `@typstream/mindmap/react`'s `MindMapIsland` makes them interactive with React Flow (pan, zoom, open and close branches), loaded with the first map.

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
