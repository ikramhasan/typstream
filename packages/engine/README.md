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
- **Last good.** A failed compile keeps the previous artifact. While streaming the status is `stale`. In final mode it is `error`. Before it comes to that, the worker's fallback (below) usually finds something to show.
- **Watchdog.**
  - Each compile gets 3 s while streaming and 10 s in final mode. Past that, the worker is terminated and an initialized spare takes over.
  - After 3 timeouts or crashes, live compiling stops (`failure.reason === "too-complex"`). `finish()` still compiles once.
- **Recycling.** A worker that reports more than 256 MiB after a compile is swapped for the spare between compiles.
- **Limits** (`limits`, PLAN §9). Input longer than `maxLength` (1 MiB of UTF-16 code units) isn't healed or compiled: the document reports `too-large` and keeps its last artifact until `set()` or `reset()` brings it back under the limit. A streaming paged compile with more than `livePages` (100) pages stops live compiling (`too-complex`); `finish()` compiles every page. How these fit the rest of the defences: the [security guide](../../apps/website/content/docs/guides/security.mdx).
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
- **`package-stub`**: an import of a package the document can't have (not allowed, still loading, failed to load) binds the names it imports to placeholders showing the package's spec. Wildcard imports and modules whose fields are used (`cetz.draw`) can't be stood in for; their error stays, and the fallback isolates the block.
- **`missing-image`**: an image the document has no file for (`#image("diagram.png")`, a URL) shows as a placeholder with the file's name, keeping the call's size and alt text and a figure's caption. Typst stops at the first image it can't read, so the server stands placeholders in for every string path without a file before the first compile; the fixer covers paths in variables, and files whose extension names another format (it reads them as bytes so Typst goes by the content, and replaces them if that fails too). In final mode the error is still reported.

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

## Fallback (Layer 4)

What still fails after the fixers is never a blank screen (PLAN §5.6). The client asks for it with every compile (`fallback: false` on a document turns it off):

- **Error blocks.** The text is split into top-level blocks (heal's root checkpoints, where source anchors go). The server finds the first failing block by compiling prefixes, bisecting (⌈log₂ n⌉ check compiles, which export nothing), and shows it as `#typstream.error-block(source, message)`: a "This part couldn't be displayed" box with the error and the block's source. Then it goes on to the next one. Blocks with syntax errors need no compile. While streaming only settled blocks are isolated, and what the server found is remembered for the next revision.
- **Stable prefix.** Once the last good render is `schedule.staleMs` old (1.5 s), the client asks for it: when the tail still being written fails, the settled text compiles with the tail as plain text below it.
- **Hangs and crashes** (final mode). A finished document that runs past the watchdog or crashes the worker is bisected by the client: prefixes compile with the rest skipped (`fallback.skip`), each under `watchdog.probeMs` (5 s). The block that doesn't finish is skipped, shown as an error block, from then on.
- **Last resort** (final mode): the whole document as one error block showing its source.

`state.lastCompile.fallback` says what was isolated (`isolated` ranges) or shown as plain text (`plainFrom`). Isolated blocks' errors stay in `diagnostics`.

## Events (telemetry)

The library sends nothing anywhere (PLAN §8.6); it reports, and the app decides what to collect. `doc.onEvent(listener)` hears one document; `engine.onEvent` hears the workers and, as `{ type: "document", event }`, every document's events too. The shapes are `@typstream/core`'s (`telemetry.ts`). Per compile, in this order, before the state it leads to is published:

| Event | When | Fields (besides `uri`, `rev`, `target`, `mode`) |
|---|---|---|
| `diagnostics` | the worker reported (with every compile, and when it recompiles on its own) | `diagnostics`, in input coordinates |
| `compiled` | a compile finished (not the probes of a hang search) | `status`, `timings`, `compileMs`, `healMs` (main-thread healing since the previous compile), `patches` and `patchReasons` (heal's patches by reason), `fixersApplied` (`{ fixer, message }`, from `CompileResult.fixes`), `fallbackLevel`, `errors`, `warnings`, `pages`, `sourceLength` |
| `fallback` | the output isn't the text as it is: level 1 (last good kept), 2 (stable prefix), 3 (error blocks), 4 (whole document as source) | `level`, `isolated`, `plainFrom`, `consecutive` (in a row), `diagnostics`, and `input` and `source`: what to replay as a corpus case |
| `watchdog` | a compile ran past its budget or crashed the worker | `reason`, `budgetMs`, `strikes`, `live`, `searching` (final mode: looking for the block that hangs) |

The worker says which fixers made a compile's output (`CompileResult.fixes`) and which rung of the ladder (`CompileResult.fallback.level`); the client adds the healing. `@typstream/dom`'s `mountTypstream` (and so `<Typstream>`) turns `compiled` into `onRendered`, with what drawing cost.

## Images

Typst reads images only from the document's files, and a model can only write a path. Without a file, an image is a placeholder (`missing-image`, above). To fill such paths in, give the document a `resolveImage(path, { signal })`: the client finds complete `image("…")` strings in the input, calls it once per path the document has no file for, and writes the bytes it returns into the document's files, which recompiles it. `null` or a throw keeps the placeholder. While an image loads its diagnostic is an `info` (`image "…" is loading`); after a throw it says why it failed.

`fetchImages({ hosts })` from `@typstream/engine/images` (its own entry point, 0.9 KB) is the resolver for `http(s)` URLs:

```ts
import { fetchImages } from "@typstream/engine/images";

const resolveImage = fetchImages({ hosts: ["upload.wikimedia.org", "*.example.edu"] });
engine.open({ resolveImage });
```

Hosts are required: a model can be steered into writing an image URL that carries what it read to someone else's server, and the page fetches it as soon as the string is complete. Requests go without credentials or referrer (`proxy` routes them through your server instead, with them). It accepts PNG, JPEG, GIF, WebP and SVG by content, up to `maxBytes` (10 MB) and `timeoutMs` (15 s), and downloads each URL once for every document. The worker never fetches images itself: a `@typstream/node` server stays offline whatever its clients' documents name.

## Typst packages

Documents may `#import "@preview/…"` packages from an allowlist (PLAN §6.4). The allowlist is the `packages` of `initialize` (engine-wide: `createEngine({ initialize: { packages } })`) plus those of each document (`engine.open({ packages })`, which `mountTypstream` fills from plugins' `engine.packages`). `@typstream/universe` vendors the packages typstream allows by default, and `typstream`'s `<Typstream>` adds them.

- **Nothing outside the allowlist is fetched.** An empty allowlist means no network. Before each compile the server scans the preamble and document for package specs (`"@preview/cetz:0.5.3"` in a string), and the allowed ones are fetched, checked against their `integrity` and untarred into the document's files. Mounted packages are scanned for their own imports.
- **Waiting.** A compile waits for its packages within the fix budget (1 s streaming, 3 s final). A package that arrives later compiles the revision again, as server-initiated output.
- **Caching.** Tarballs are kept in Cache Storage (`typstream-packages`) where there is one, so allowed packages work offline after the first load, and in memory for every document of the worker.
- **Other versions.** A version that isn't allowed resolves to the nearest allowed one (same major.minor, else the newest) with a warning on the import. Models often write old versions.
- **Errors.** A missing package is reported as `package … is not allowed` (with the allowed ones as a hint), `is still loading` or `failed to load (reason)`.
- **Local packages.** Files keyed `@namespace/name:x.y.z/path` (a document's or a plugin's `files`) are that package's files, so `#import "@typstream/edu:0.1.0"` works with no allowlist or download.
- **Server options.** A server's own `serve(adapter, scope, { packages })` options set its allowlist, a `registry` for specs without a `url`, the cache, and `trustClient: false`, which ignores the client's lists. `@typstream/node` sets that, so WebSocket clients can't make it fetch URLs.

Tests: `pnpm test` (Node: client, server, protocol conformance against engine-wasm) and `pnpm test:browser` (the real worker in Chromium, Firefox and WebKit). Any engine server must pass `__tests__/conformance.ts`.
