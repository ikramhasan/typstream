---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/engine-wasm": minor
"@typstream/dom": minor
"@typstream/react": minor
"@typstream/mindmap": minor
---

Render islands (#28, beta): interactive components mounted over markers a document's Typst writes around its own fallback drawing, which is what prints, exports and shows wherever nothing mounts. core settles the contract: `ISLAND_MARKER`, `IslandSpec { description, parse }` in the plugin's `islands` facet, `IslandProps`, and `PagedIsland` on `PagedArtifact.islands`. engine-wasm finds the paged target's island markers in each laid-out document (page, position, value, source offset), and the engine sends them with every paged artifact; `EngineDocument.file(path)` gives islands the bytes a document has. dom's HTML renderer and `mountTypstream` take `islands`, framework-free renderers by name, and keep one mounted island per marker while its block streams; `@typstream/react`'s `islands` prop renders React components into them through portals. The paged view's overlay follows the canvas pages (#14).

New package `@typstream/mindmap`, the first island: mind maps written as a list (`#mindmap[…]`, `#topic(…)` for a node's colour, size, weight, image or collapsed branches, `text-focused` and one-sided styles), drawn in plain Typst, with its prompt kit; `@typstream/mindmap/react`'s `MindMapIsland` makes them interactive with React Flow (pan, zoom, open and close branches), loaded with the first map.
