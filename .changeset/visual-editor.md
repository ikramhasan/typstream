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

The visual editor (#36), beta: a Typst document edited on its own pages, so what the teacher edits is what prints and exports. New packages: `@typstream/syntax` (Typst's parser as wasm: the lossless syntax tree with UTF-16 offsets), `@typstream/editor-core` (the editor without a framework: `createEditor` puts a caret, a selection and the keyboard on the page view's pages; commands turn typing, Backspace, Enter, marks, block types, lists, alignment, tables and components into minimal edits of the source, with a word processor's list keys (Enter on an empty item moves it up a level or ends the list, Tab and Shift+Tab, Backspace at an item's start) and Ctrl+Enter out of a component (`exitBlock`); the caret stands where Typst lays out nothing (a paragraph's last space, an empty paragraph, item or cell: `caretAnchor`, a placeholder compiled there and never written to the source, `laidOut`); plugins after Plate's and ProseMirror's: keymaps with priorities that fall through, `handleKeyDown`, `handleTextInput`, `handlePaste`, decorations and plugin views, the editor's own keys a plugin (`keysPlugin`, `baseKeymap`: `deleteWord`, Tab through table cells with `moveCell`); `runKey`, PageUp/PageDown, Cut/Copy/Paste from the context menu, scrolling while dragging a selection, a `placeholder` in an empty document) and `@typstream/editor-react` (`<TypstEditor>`: the fixed and floating toolbars, insert and slash menus, bars over components with their settings, table rows and columns, an equation's formula). The engine reports where the source was laid out on every page (`positions: true` on a document or compile; `PagedArtifact.positions`, `PagePositions`, `PageElement`, `DocumentState.artifactInput`, `setPositions`). A plugin's `editor` facet declares its components (`EditorComponentSpec`, `EditorParamSpec`); edu's (`eduComponents`) and mindmap's fill it in.
