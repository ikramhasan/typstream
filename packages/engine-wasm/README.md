# @typstream/engine-wasm

Typst 0.15.1 compiled to WebAssembly. It compiles an in-memory project to HTML, or to SVG for only the pages that changed since the last compile, and returns diagnostics with UTF-16 spans. It's the default engine behind `@typstream/engine` (PLAN.md §6.1), meant to run in a Web Worker.

```ts
import init, { Engine } from "@typstream/engine-wasm";

await init(); // fetches engine_bg.wasm next to engine.js; or init({ module_or_path: url | bytes | WebAssembly.Module })
const engine = new Engine();
for (const font of fonts) engine.add_font(font); // Uint8Array per TTF/OTF/TTC file

engine.set_source("/main.typ", "= Hello\nInline math $x^2$.");
const { ok, html, diagnostics } = engine.compile_html();

// Paged preview: only the pages whose content changed.
const { pageCount, changed } = engine.compile_svg_changed(); // changed: { index, svg }[]
```

In Node or a worker that already has the bytes: `initSync({ module: bytes })`.

## API

| | |
|---|---|
| `new Engine()` | An empty project with an empty `/main.typ`. |
| `add_font(bytes)` | Adds a font file; returns the number of faces (a TTC has several). |
| `set_source(path, text)` | Sets a source file. `/main.typ` is the entry point. Existing sources are updated incrementally. |
| `set_file(path, bytes)` / `remove_file(path)` | Binary files (images, data). `/main.typ` can't be removed. |
| `set_inputs({ key: "value" })` | `sys.inputs`. Values must be strings. |
| `compile_html()` | `{ ok, html?, diagnostics, ms }` |
| `compile_svg_changed()` | `{ ok, pageCount?, changed?, diagnostics, ms, compileMs, exportMs }`. A failed compile keeps the previous pages as the baseline. |
| `reset_pages()` | The next `compile_svg_changed` sends every page. |
| `Engine.features()` | `["html", "svg"]`, plus `"pdf"` in builds with that feature. |
| `Engine.memory_bytes()` | Wasm linear memory in bytes. |

Paths are virtual and absolute (`/img/a.png`); invalid ones throw. Methods that compile never throw for document errors; those come back as diagnostics.

A `Diagnostic` is `{ severity, message, hints, trace, file?, span? }`. `span` is `{ from, to }` in **UTF-16 code units** of `file`'s text, so `source.slice(span.from, span.to)` is the offending text. `trace` lists the calls, show rules and imports the error came through, each with its own `file`/`span`. The warning Typst emits on every HTML compile ("html export is under active development") is dropped.

Things to know:
- **Every compile calls `comemo::evict(2)`.** Typst's memoization cache would otherwise grow by ~4 MiB per compile; with it, memory stays flat over hundreds of streaming compiles.
- The memoization cache and memory are **global to the wasm instance**, shared by every `Engine` in it. Wasm memory never shrinks; recycle the worker to give it back.
- No packages, network or filesystem: a document can read only what was set on the engine.
- `datetime.today()` is the local date, as in the Typst CLI.
- PDF export isn't in the default build (`FEATURES=pdf ./build.sh` adds `compile_pdf()`); how PDF ships is #18.

## Building

Needs Rust ≥ 1.92 with `wasm32-unknown-unknown`, `wasm-bindgen-cli` at exactly the version in `Cargo.lock` (0.2.129), and binaryen's `wasm-opt`.

```bash
pnpm build        # ./build.sh: cargo release build, wasm-bindgen --target web, wasm-opt -Oz → dist/
pnpm test         # vitest, against the existing dist/
pnpm turbo run test --filter=@typstream/engine-wasm   # from the repo root: build if needed, then test
pnpm size         # brotli-11 size of the wasm; budget 6.0 MB
```

The tests use Typst's bundled fonts from the `typst-assets` crate (found with `cargo metadata`) and compare against the native `typst` CLI 0.15.1, which must be on `PATH`. They check that HTML and every SVG page are identical to native output.
