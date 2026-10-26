---
"@typstream/engine": minor
"@typstream/engine-wasm": minor
---

The engine's worker half (#10). `@typstream/engine/server` has the protocol server (`serve`, `createServer`, `inProcess`), the `EngineAdapter` interface and the engine-wasm adapter (`engineWasm`); `engineWorker()` spawns the default worker, which bundlers (Vite, Next.js) pick up with the wasm and fonts. engine-wasm now ships the base fonts (`@typstream/engine-wasm/fonts`) and reports each changed page's `hash`, `width` and `height`.
