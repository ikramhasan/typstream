---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/engine-wasm": minor
"@typstream/node": minor
---

New package `@typstream/node` (#22): `validate` and `render` (PDF, HTML, SVG) on the server, `formatDiagnosticsForLLM` and `fixLoop` for LLM repair, and the worker protocol over WebSocket (`createProtocolServer`, `handleWebSocket`). It runs `@typstream/engine-wasm` on worker threads with a watchdog per compile.

`@typstream/core` adds `serializeMessage` / `deserializeMessage`, a JSON wire format for protocol messages that carries bytes as base64.

`@typstream/engine`'s server passes each compile's `mode` to the adapter (`AdapterCompileOptions`; exports are `final`), answers unknown methods with `method-not-found`, and exports `fromMain`. `@typstream/node` serves the protocol with it.

`@typstream/engine-wasm` adds `check_paged()` (a paged compile without export) and PDF export (`compile_pdf()`).
