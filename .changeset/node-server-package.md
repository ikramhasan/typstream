---
"@typstream/core": minor
"@typstream/engine-wasm": minor
"@typstream/node": minor
---

New package `@typstream/node` (#22): `validate` and `render` (PDF, HTML, SVG) on the server, `formatDiagnosticsForLLM` and `fixLoop` for LLM repair, and a WebSocket server for the worker protocol (`createProtocolServer`, `handleWebSocket`). It runs `@typstream/engine-wasm` on worker threads with a watchdog per compile.

`@typstream/core` adds `serializeMessage` / `deserializeMessage`, a JSON wire format for protocol messages that carries bytes as base64.

`@typstream/engine-wasm` adds `check_paged()` (a paged compile without export) and a second build with PDF export, `@typstream/engine-wasm/pdf`.
