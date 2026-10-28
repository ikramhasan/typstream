# @typstream/mindmap

Mind maps for typstream (#28, PLAN.md §8.4): written as a list, drawn in plain Typst for print, PDF and every renderer,
and interactive in `<Typstream>` (pan, zoom, open and close branches). The first render island.

```typst
#mindmap[
  Photosynthesis
  - Inputs
    - Sunlight
    - Water ($H_2 O$)
  - #topic(color: "#16a34a", collapsed: true)[Outputs]
    - Glucose
    - Oxygen
]
```

```tsx
import { mindmap } from "@typstream/mindmap";
import { mindmapIslands } from "@typstream/mindmap/react";

<Typstream source={text} plugins={[mindmap]} islands={mindmapIslands} />;
buildSystemPrompt([edu, mindmap]); // the model learns `#mindmap`
```

- **Typst** (`typst/`): `mindmap(style:, layout:, text-size:)[centre, then a list]` and `topic(color:, size:, weight:,
  image:, collapsed:)[label]`, which cover the fields of Monsha's mind map format. Drawn with `measure`, `place` and
  `curve`, not CeTZ: 9–11 ms per compile while streaming in engine-wasm. Every parameter takes what a stream cut leaves.
  The drawing sits in an island marker (`island.typ`) carrying the resolved tree as data.
- **Plugin** (`.`): the files as a local package `@typstream/mindmap:0.1.0`, the preamble, the prompt kit (catalogue
  from the `///` doc comments, rules, `examples/`), and the `mindmap` island with `parseMindMap`, which checks the
  marker's untrusted data.
- **Interactive map** (`./react`): React Flow, loaded with the first map (64.8 KB gzipped with its CSS), laid out like
  the drawing (`src/react/layout.ts`) on labels measured in the page's font, read-only. CSS is adopted as constructable
  stylesheets (strict CSP). Paged target: when #14's overlay lands; until then, the drawing.
- `pnpm embed` after editing `typst/` or `examples/` (a test checks `src/assets.generated.ts` and React Flow's CSS).
  `pnpm test` compiles through engine-wasm and native `typst` (every healed stream prefix of the examples);
  `pnpm test:browser` mounts the island on the real engine worker in Chromium, Firefox and WebKit; `pnpm size`.

Docs: [reference](../../apps/website/content/docs/reference/mindmap.mdx),
[Writing an island](../../apps/website/content/docs/guides/islands.mdx).
