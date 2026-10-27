---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/dom": minor
"@typstream/react": minor
"typstream": minor
"@typstream/node": patch
---

Events and telemetry hooks (#30). The library still sends nothing itself; it reports, and the app wires the hooks. Core adds the event shapes (`CompiledEvent`, `RenderedEvent`, `FallbackEvent`, `WatchdogEvent`, `DiagnosticsEvent`, `FallbackLevel`), `CompileResult.fixes` (the errors Layer 3's fixers fixed for the output, as `AppliedFix`) and `CompileFallback.level` (2 stable prefix, 3 error blocks, 4 the whole document). The engine client times healing on the main thread and emits every document's events through `EngineDocument.onEvent` and, as `{ type: "document", event }`, `Engine.onEvent`. `mountTypstream` and `<Typstream>` take `onFallback` and `onWatchdog`, and `onRendered` now receives a `RenderedEvent` (rev, timings, compile and heal ms, patches by reason, fixes, fallback level, render ms, blocks or pages) in place of the `@beta` `RenderedInfo`, which is gone. `TypstreamProvider` takes the telemetry hooks too, and calls them alongside each instance's. `@typstream/node`'s protocol server reports the fallback level.
