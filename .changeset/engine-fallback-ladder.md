---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/node": minor
---

Layer 4, the fallback ladder (#21): a document that still doesn't compile after the fixers renders anyway. Clients ask for it per compile with core's new `CompileParams.fallback` (`isolate`, `stablePrefix`, `skip`); `CompileResult.fallback` says what the artifact shows instead of the text and `timings.fallbackMs` what it cost. The engine server shows each top-level block that fails as an error block ("This part couldn't be displayed", the error, the block's source), found by bisecting prefixes with check compiles (new optional `AdapterDocument.check`); while streaming it shows the unsettled tail as plain text below the settled text once the client's last good render is stale (`ScheduleOptions.staleMs`, 1.5 s), and in final mode the whole document as source as a last resort. The engine client asks for it with every compile (`DocumentOptions.fallback: false` turns it off), and when a finished document runs past the watchdog or crashes the worker it finds the blocks responsible by compiling prefixes, each under `WatchdogOptions.probeMs`, and skips them. `@typstream/node`'s protocol server accepts the new params and checks prefixes on its pool, where a stopped compile isolates its block.
