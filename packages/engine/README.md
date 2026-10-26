# @typstream/engine

Compiles streamed Typst in a worker. The main-thread client heals each document with `@typstream/heal`, decides when to compile, and keeps the preview alive when compiles fail, hang or crash. The worker half (the engine server around `@typstream/engine-wasm`) is [#10](https://github.com/ikramhasan/typstream/issues/10).

```ts
import { createEngine, fromWorker } from "@typstream/engine";

const engine = createEngine({ spawn: fromWorker(() => new Worker(workerUrl, { type: "module" })) });
const doc = engine.open({ target: "html" });

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
