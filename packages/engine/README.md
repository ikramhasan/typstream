# @typstream/engine

Compiles streamed Typst in a worker. The main-thread client heals each document with `@typstream/heal`, decides when to compile, and keeps the preview alive when compiles fail, hang or crash. The worker runs the engine server around `@typstream/engine-wasm` (Typst 0.15.1).

```ts
import { createEngine, engineWorker } from "@typstream/engine";

const engine = createEngine({ spawn: engineWorker() });
const doc = engine.open({ target: "html" }); // or "paged": SVG pages

doc.subscribe(({ status, artifact, diagnostics }) => render(artifact, status, diagnostics));
for await (const chunk of llmStream) doc.push(chunk);
doc.finish(); // strict heal, final compile → status "done" or "error"
```

## What the client does

- **Heals on the main thread.** Every `push` / `set` / `applyEdit` runs the incremental healer. A change that heals to the same source doesn't compile.
- **Latest wins.** The engine runs one compile at a time across all its documents. Each document has at most one compile pending, and it reads the newest healed source when its turn comes. Edits reach the worker as one diff right before the compile.
- **Adaptive interval.** Compiles start at most every `clamp(minInterval, 1.25 × EMA(compileMs), maxInterval)` (33–500 ms by default). When a line or block has just finished (heal's `stableOffset` advanced), the next compile is due after `minInterval` instead.
- **Stale output is dropped.** Diagnostics and artifacts count only for the revision last sent. Diagnostics are mapped back to input positions.
- **Last good.** A failed compile keeps the previous artifact. While streaming the status is `stale`. In final mode it is `error`.
- **Watchdog.**
  - Each compile gets 3 s while streaming and 10 s in final mode. Past that, the worker is terminated and an initialized spare takes over.
  - After 3 timeouts or crashes, live compiling stops (`failure.reason === "too-complex"`). `finish()` still compiles once.
- **Recycling.** A worker that reports more than 256 MiB after a compile is swapped for the spare between compiles.
- **Paged output.** Changed-page artifacts are merged, so `state.artifact` always has every page.

Status: `idle` → `compiling` → `idle` while streaming; `stale` after a failure; `done` / `error` once finished. Everything runs on injected timers (`clock`), so the client works in Node with a fake worker. See `__tests__/support/fake-worker.ts`.

## The worker

`engineWorker()` spawns the default worker: engine-wasm with the base fonts (Libertinus Serif, New Computer Modern Math, DejaVu Sans Mono). It is written as `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`, and the worker refers to the wasm and fonts the same way, so bundlers emit all of them as assets. Vite and Next.js (Turbopack or webpack) need no configuration. The wasm is about 19 MB (≈ 6 MB brotli) and the fonts 2.6 MB; serve them compressed and cacheable.

To load the wasm or fonts from somewhere else, write your own worker with `@typstream/engine/server`:

```ts
// engine.worker.ts
import { engineWasm, serve } from "@typstream/engine/server";
serve(engineWasm({ wasm: "https://cdn.example.com/typst-0.15.1.wasm", fonts: ["/fonts/Libertinus.otf"] }));

// main thread
const engine = createEngine({
  spawn: fromWorker(() => new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" })),
});
```

The server speaks the protocol in `@typstream/core` over any `EngineAdapter` (`createServer` for other transports, `inProcess` to run it on the calling thread in tests or Node). It keeps each document's text, preamble (evaluated before the document; diagnostics stay in document coordinates), files and inputs, and sends changed pages only. A wasm trap (a Typst panic, or out of memory) ends the worker so the client replaces it.

## Fixers (Layer 3)

When a compile fails, the server tries its diagnostic fixers and recompiles, at most twice per revision, so streamed text that heals but doesn't compile yet still renders:

- **`tail-cut`** (streaming only): an error in the text still being typed (after heal's `stableOffset`, which the client sends as `settled`) cuts the text there and heals the rest again. `#text(` without its body, `#v(1`, `rgb("#e` and closure parameters before `=>` drop out until the next tokens bring them back.
- **`pending-ref`**: a reference to a label that doesn't exist yet (a citation before `#bibliography`) shows its key as a muted placeholder. In final mode the error is still reported.

Placeholders come from a small Typst library mounted at `/@typstream/runtime.typ` (a document's own file at that path replaces it). Fixed errors are reported as `info` diagnostics (`source` is the fixer's name) while streaming. Plugins add fixers as ES modules whose default export is a `DiagnosticFixer` or an array of them:

```ts
// acme-fixers.js, loaded in the worker
export default {
  name: "acme/old-macro",
  match: /^unknown variable: oldbox$/,
  fix: (d, { text }) => [{ from: d.span.from, to: d.span.to, insert: "box" }],
};

// main thread
createEngine({ spawn: engineWorker(), initialize: { fixerModules: [new URL("./acme-fixers.js", import.meta.url).href] } });
```

A custom worker can replace the list: `serve(engineWasm(), undefined, { fixers: [pendingRef, myFixer, tailCut] })`; `[]` turns them off.

Tests: `pnpm test` (Node: client, server, protocol conformance against engine-wasm) and `pnpm test:browser` (the real worker in Chromium, Firefox and WebKit). Any engine server must pass `__tests__/conformance.ts`.
