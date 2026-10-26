# @typstream/node

Typst on the server, for apps that save LLM-written documents:

- **validate** a document before saving it;
- **render** it to PDF, HTML or SVG;
- turn its diagnostics into a **repair prompt** and run the **fix loop** with your model;
- **serve the engine protocol** over WebSocket to browsers that shouldn't download the 6 MB engine.

It runs `@typstream/engine-wasm` (Typst 0.15.1) on worker threads. That's the same build browsers run, so a document that validates here renders the same in the preview. A watchdog stops runaway documents.

```ts
import { fixLoop, formatDiagnosticsForLLM, render, validate } from "@typstream/node";

const { ok, diagnostics } = await validate(source);
if (!ok) console.log(formatDiagnosticsForLLM(source, diagnostics));

const result = await fixLoop({
  source,
  generate: async ({ prompt, source }) => callYourModel(`${prompt}\n\n${source}`),
});
if (result.ok) {
  const pdf = await render(result.source, "pdf");
  if (pdf.ok) save(pdf.data);
}
```

`examples/node-validate` runs this end to end.

## API

| | |
|---|---|
| `validate(source, options?)` | `{ ok, diagnostics, pageCount?, ms }`. Compiles without exporting (`target: "paged"` by default, or `"html"`) and adds `@typstream/heal`'s lint findings as warnings (`lint: false` to skip, or per-rule settings). |
| `render(source, format, options?)` | `format` is `"pdf"` (bytes), `"html"` (a string) or `"svg"` (one string per page). `{ ok: true, data, diagnostics, pageCount? }` or `{ ok: false, diagnostics }`. |
| `formatDiagnosticsForLLM(source, diagnostics, options?)` | A compact repair prompt in the Typst CLI's layout: message, `--> line, column`, the line with `^^^` under the problem, notes and hints. Errors first, at most `maxDiagnostics` (10). |
| `fixLoop({ source, generate, maxRounds?, strict?, ... })` | Validate → `generate({ source, diagnostics, prompt, round })` → validate, until clean or `maxRounds` (3). Returns the best attempt and all attempts. `strict` also repairs lint warnings. |
| `createEngine(options?)` | Workers, fonts and budgets; pass it as `engine` to the calls above. Otherwise a default engine is created on first use. |
| `createProtocolServer(options?)`, `handleWebSocket(ws, server)` | The worker protocol from `@typstream/core`, served over WebSocket. |

Options every compile takes: `preamble` (Typst evaluated before the document), `files` (images, data and `.typ` files by relative path), `inputs` (`sys.inputs`), `timeoutMs`, `engine`.

Positions in diagnostics are UTF-16 offsets into `source`, as everywhere in typstream. Diagnostics inside the preamble carry `file: { path: "<preamble>" }`.

### Engine

```ts
const engine = createEngine({
  workers: 4,                     // most worker threads; default min(4, cores - 1)
  timeoutMs: 10_000,              // watchdog per compile
  fontPaths: ["/srv/fonts/noto"], // more fonts, searched recursively (like typst --font-path)
  fonts: [bytes],                 // or as bytes
  typstFonts: true,               // Typst's bundled fonts (default)
});
await validate(source, { engine });
await engine.close();
```

Workers start on demand, keep Typst's caches warm between calls, and don't keep the process alive while idle.

A compile over budget is stopped by terminating its worker. The result is an error diagnostic with `code: "timeout"`. A document that exhausts wasm memory (allocations fail at about 2 GiB in wasm32) comes back as `code: "engine-crashed"`. Either way the worker is replaced and the process is unaffected. That's why this runs Typst as wasm rather than as a native addon, whose compiles can't be interrupted (#22).

The bundled fonts are Libertinus Serif, New Computer Modern and DejaVu Sans Mono, the set `typst compile --ignore-system-fonts` uses. Licenses are in `dist/fonts/NOTICE`. Documents can't read the server's filesystem or the network, only the `files` you pass.

### Serving the protocol

```ts
import { WebSocketServer } from "ws";
import { createProtocolServer, handleWebSocket } from "@typstream/node";

const server = createProtocolServer({ timeouts: { streaming: 3_000, final: 10_000 }, maxDocuments: 32 });
new WebSocketServer({ port: 8080, maxPayload: 8 << 20 }).on("connection", (ws) => handleWebSocket(ws, server));
```

The protocol is served by `@typstream/engine`'s server, the same code that runs in the browser worker, over an adapter that compiles on this package's worker pool.

- **Sessions:** each connection is a session with its own documents. Closing the socket cancels its queued requests and frees its documents.
- **Wire format:** JSON, with bytes as `{ "$bytes": "<base64>" }`. `serializeMessage` / `deserializeMessage` from `@typstream/core` read and write it in the browser.
- **What it offers:** HTML and paged targets (with changed-page updates), PDF and HTML exports. No `resolve/*`.
- **Untrusted clients:** messages are checked before the server reads them, and too many documents or too long a text answer `invalid-params`.
- **Watchdog:** documents live on the main thread and workers only compile, so a watchdog kill costs one compile, not the session.

## Building and testing

`pnpm build` bundles the TypeScript and copies Typst's fonts from the `typst-assets` crate into `dist/fonts`. It needs `@typstream/engine-wasm` built first, and so Rust.

`pnpm test` runs:
- the whole corpus through `validate`, with page counts checked against native Typst's;
- the watchdog and crash recovery;
- `fixLoop` with a scripted model;
- `@typstream/engine`'s protocol conformance suite, in-process and over a real WebSocket, plus the server's own behaviour (watchdog per mode, malformed input, limits, disconnects).
