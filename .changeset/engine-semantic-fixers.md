---
"@typstream/core": minor
"@typstream/engine": minor
---

Layer 3 diagnostic fixers (#20). When a compile fails, the engine server tries its fixers and recompiles, at most twice per revision: `tail-cut` drops the text still being typed where it doesn't compile yet (the client now sends heal's `stableOffset` as `compile.settled`), and `pending-ref` shows a reference to a label that doesn't exist yet, such as a citation before its `#bibliography`, as a muted placeholder. Placeholders come from a Typst runtime library mounted at `/@typstream/runtime.typ`. Fixed errors are reported as `info` diagnostics while streaming; `timings.fixMs` measures the rounds. Core adds `DiagnosticFixer`, `FixContext`, `InitializeOptions.fixerModules` (plugin fixers loaded in the worker by URL) and `CompileParams.settled`; `@typstream/engine/server` exports `DEFAULT_FIXERS`, `pendingRef`, `tailCut` and `RUNTIME_PATH`, and `serve` / `inProcess` take a `fixers` option. On the corpus, 99.93% of streamed prefixes now compile, up from 88%.
