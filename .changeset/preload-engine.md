---
"@typstream/engine": minor
"@typstream/react": minor
"typstream": minor
---

Preload the engine before the first document (beta). `engine.preload({ plugins, targets, text })` compiles
throwaway documents so the first real one finds the wasm compiled, the fonts parsed and its plugins' packages,
modules and fonts loaded. `prefetchEngine()` from the new `@typstream/engine/prefetch` entry downloads the default
worker's wasm and base fonts into the browser's caches without starting a worker. `@typstream/react` and `typstream`
add `preloadTypstream(options)`, which warms the page's shared engine and keeps it for `holdMs` (a minute; `level:
"fetch"` only downloads), and `usePreloadTypstream(when, options)`, which keeps it warm while a component is mounted.
