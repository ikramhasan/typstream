---
"@typstream/syntax": minor
"@typstream/editor-core": minor
"@typstream/editor-react": minor
"@typstream/core": minor
"@typstream/react": minor
"@typstream/edu": minor
---

The visual editor (#36, beta). `@typstream/editor-react`'s `<TypstEditor>` edits a Typst document as rich text with Plate: a fixed and a floating toolbar as Plate's, a slash menu, Typst's shortcuts (`= `, `- `, `+ `, `*bold*`), code and equations shown compiled and edited as source, export and import, and "Ask AI" with the selection's source range. Every change comes out as one minimal `TextEdit`; blocks the teacher doesn't touch keep their source exactly. `@typstream/editor-core` is its model (Typst ⇄ Plate value), `@typstream/syntax` Typst's parser as wasm. Core's `EditorFacet` is typed (`EditorInsertItem`, `EditorNodeSpec`), edu fills it (`eduEditorItems`, `eduEditorNodes`), and `@typstream/react` exports `useTypstreamDefaults`.
