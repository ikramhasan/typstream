# @typstream/mermaid

Mermaid diagrams for typstream, drawn by [pele](https://pele.run) (Obsidian's Mermaid renderer). A model writes a
`mermaid` raw block, as in Markdown; the document shows the diagram in every target: the paged view, the HTML target,
the PDF and a DOCX export.

````typst
#figure(kind: image, caption: [The water cycle.])[
  ```mermaid
  flowchart LR
    A[Ocean] -->|Evaporation| B[Water vapour] -->|Condensation| C[Clouds]
  ```
]
````

```tsx
import { mermaid } from "@typstream/mermaid";

<Typstream source={text} plugins={[mermaid]} />; // `typstream`'s <Typstream>, which has html-compat
buildSystemPrompt([edu, mermaid]); // the model learns ```mermaid blocks
```

- **Generator** (`src/generator.ts`, built to `generator/mermaid.js` with pele bundled, 276 KB gzipped): a file
  generator (PLAN §8.2) the engine's worker imports by URL (`MERMAID_GENERATOR`). Before each compile it finds the
  blocks (`src/scan.ts`), draws each with pele (`src/draw.ts`), and splits pele's SVG into shapes, its CSS variables
  resolved, and labels (`src/svg.ts`), measured in Libertinus Serif's widths (`src/measure.ts`). It writes an index of
  drawings and one SVG per drawing into the Typst package.
- **Typst** (`typst/lib.typ`): the preamble's show rule draws each block from the index: the shapes as an image, the
  labels as Typst text, 16 pele pixels to the text size, shrunk to the column. Code until a block's first drawing;
  pele's error in final mode.
- **Plugin** (`.`): the package's files, the preamble, the generator's URL, the prompt kit (`examples/`). Depends on
  html-compat. `@typstream/mermaid/generator` is the generator itself, for servers (`ServerOptions.generators`).
- `pnpm embed` after editing `typst/` or `examples/`; `pnpm widths` to regenerate the measurer's widths. `pnpm test`,
  `pnpm test:paged` and `pnpm test:docx` (the conformance suite), `pnpm size`.

Docs: [reference](../../apps/website/content/docs/reference/mermaid.mdx).
