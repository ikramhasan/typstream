# Typstream

[![CI](https://github.com/ikramhasan/typstream/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ikramhasan/typstream/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Ftotal.json)](https://github.com/ikramhasan/typstream/actions/workflows/coverage.yml)

Render [Typst](https://typst.app) streamed from an LLM, live, in the browser. Built for an AI tool that writes
educational documents (worksheets, quizzes, exams, lesson plans, handouts): the model writes Typst, and the document
renders as it arrives, as semantic HTML or as pages, then as the finished document, exportable to PDF.

```tsx
import { Typstream } from "typstream";

<Typstream source={text} isStreaming={status === "streaming"} animated caret />;
```

Typst is a compiled language, so a half-written document usually doesn't compile. Typstream heals each prefix of the
stream into one that parses (`#question(` → `#question()`), compiles it with Typst 0.15.1 built to wasm in a worker,
and keeps the last good render on screen when a compile fails. [How it works](https://typstream.vercel.app/docs/concepts/how-it-works).

```sh
npm install typstream
```

[Installation](https://typstream.vercel.app/docs/getting-started/installation) covers the other packages, bundlers and
serving the engine.

## Packages

| Package | |
| --- | --- |
| [`typstream`](packages/typstream) | `<Typstream>` with the defaults an app wants (html-compat, the math font, Typst packages). |
| [`@typstream/react`](packages/react) | `<Typstream>`, `TypstreamProvider`, `useTypstream()`. |
| [`@typstream/dom`](packages/dom) | Framework-free renderers: HTML blocks, pages on canvases, render islands, standalone HTML export. |
| [`@typstream/engine`](packages/engine) | The compile worker and its main-thread client: scheduling, watchdog, last good render, fallback. |
| [`@typstream/engine-wasm`](packages/engine-wasm) | Typst 0.15.1 as wasm: HTML, pages, PDF, diagnostics. |
| [`@typstream/docx`](packages/docx) | The Word export's writer: editable `.docx` files laid out as Typst laid them out. |
| [`@typstream/heal`](packages/heal) | Heals streamed prefixes so they parse; a port of Typst's parser, tested against the real one. |
| [`@typstream/core`](packages/core) | Edits, positions, source maps, and the protocol and plugin types. |
| [`@typstream/ai`](packages/ai) | AI SDK glue: an assistant message as a document, and streaming edits. |
| [`@typstream/node`](packages/node) | Typst on the server: validate a document before saving it, render it to PDF, HTML or SVG. |
| [`@typstream/edu`](packages/edu) | The Typst vocabulary for teachers' documents (questions, answers and keys, rubrics, drawings), with its prompt kit. |
| [`@typstream/html-compat`](packages/html-compat) | Keeps grids, alignment, shapes and placement in Typst's HTML export. |
| [`@typstream/universe`](packages/universe) | The Typst Universe packages allowed by default (CeTZ, fletcher, physica, …), vendored. |
| [`@typstream/google-fonts`](packages/google-fonts) | Any Google Fonts family by name. |
| [`@typstream/mindmap`](packages/mindmap) | Mind maps, drawn in Typst and interactive in React. |
| [`@typstream/mermaid`](packages/mermaid) | Mermaid diagrams, drawn by [pele](https://pele.run), the same on pages, in PDF and in Word. |

Guides and reference are at [typstream.vercel.app/docs](https://typstream.vercel.app/docs) (source in
[`apps/website/content/docs`](apps/website/content/docs)), starting with
[installation](https://typstream.vercel.app/docs/getting-started/installation). Examples: [`examples/vite-react`](examples/vite-react)
and [`examples/vanilla`](examples/vanilla) (Vite, with React and without), and a chat app,
[`examples/nextjs-ai-sdk`](examples/nextjs-ai-sdk).

## Development

Node ≥ 20 and pnpm 12. The engine and heal's test oracle also need Rust ≥ 1.92 with the `wasm32-unknown-unknown`
target, `wasm-bindgen-cli`, `binaryen`, and the native `typst` 0.15.1 CLI ([`CLAUDE.md`](CLAUDE.md) has the details).

```bash
pnpm install
pnpm oracle          # Typst's own parser as a test oracle (heal's tests need it)
pnpm build
pnpm test
pnpm check           # Biome lint and format
pnpm --filter playground dev   # the dev playground: replay streams, inspect healing and the engine
```

## Test coverage

Line and branch coverage of the TypeScript packages, from their Node tests and their browser tests in Chromium,
measured after every merge to `main` ([Coverage workflow](https://github.com/ikramhasan/typstream/actions/workflows/coverage.yml);
`pnpm coverage` locally).

| Package | Lines | Branches |
| --- | --- | --- |
| `@typstream/core` | ![core lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fcore.lines.json) | ![core branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fcore.branches.json) |
| `@typstream/heal` | ![heal lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fheal.lines.json) | ![heal branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fheal.branches.json) |
| `@typstream/engine` | ![engine lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fengine.lines.json) | ![engine branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fengine.branches.json) |
| `@typstream/dom` | ![dom lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fdom.lines.json) | ![dom branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fdom.branches.json) |
| `@typstream/react` | ![react lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Freact.lines.json) | ![react branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Freact.branches.json) |
| `@typstream/mindmap` | ![mindmap lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fmindmap.lines.json) | ![mindmap branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fmindmap.branches.json) |
| `@typstream/ai` | ![ai lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fai.lines.json) | ![ai branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fai.branches.json) |
| `@typstream/node` | ![node lines](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fnode.lines.json) | ![node branches](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fikramhasan%2Ftypstream%2Fbadges%2Fnode.branches.json) |

Line coverage isn't the whole picture. Code in other languages isn't measured: engine-wasm's Rust is tested against
native `typst`, and the Typst in edu, html-compat and mindmap is compiled by their tests, with engine-wasm and native
`typst`, in both targets. Heal also has property tests against Typst's own parser (a 20,000-run campaign nightly) and
mutation testing (Stryker, nightly, fails below 80%). The corpus-wide browser suites (equivalence, flicker,
accessibility, visual regression, preview vs PDF) are in [`tools/browser-suites`](tools/browser-suites).

## License

MIT. The packages that ship third-party code include its notices: `@typstream/engine-wasm` (Typst and the other crates
in its wasm, `dist/THIRD-PARTY-NOTICES.txt`, and its fonts, `dist/fonts/`), `@typstream/node` (the same fonts),
`@typstream/mermaid` (pele) and `@typstream/mindmap` (React Flow's stylesheet), each in `THIRD-PARTY-NOTICES.txt`, and
`@typstream/universe` (the vendored Typst packages, which keep their own licenses, `NOTICE`).
