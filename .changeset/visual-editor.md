---
"@typstream/syntax": minor
"@typstream/editor-core": minor
"@typstream/editor-react": minor
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/react": patch
"@typstream/edu": minor
"@typstream/mindmap": minor
---

The visual editor (#36), beta: a Typst document edited on its own pages, so what the teacher edits is what prints and exports. New packages: `@typstream/syntax` (Typst's parser as wasm: the lossless syntax tree with UTF-16 offsets), `@typstream/editor-core` (the editor without a framework: `createEditor` puts a caret, a selection and the keyboard on the page view's pages; commands turn typing, Backspace, Enter, marks, block types, lists, alignment, tables and components into minimal edits of the source; plugins after Plate's) and `@typstream/editor-react` (`<TypstEditor>`: the fixed and floating toolbars, insert and slash menus, bars over components with their settings, table rows and columns, an equation's formula). The engine reports where the source was laid out on every page (`positions: true` on a document or compile; `PagedArtifact.positions`, `PagePositions`, `PageElement`, `DocumentState.artifactInput`, `setPositions`). A plugin's `editor` facet declares its components (`EditorComponentSpec`, `EditorParamSpec`); edu's (`eduComponents`) and mindmap's fill it in.
