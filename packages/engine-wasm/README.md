# @typstream/engine-wasm

Typst 0.15.1 compiled to WebAssembly. It compiles an in-memory project to HTML, to SVG for only the pages that changed since the last compile, or to PDF, and returns diagnostics with UTF-16 spans. It's the default engine behind `@typstream/engine` (PLAN.md §6.1), meant to run in a Web Worker.

```ts
import init, { Engine } from "@typstream/engine-wasm";

await init(); // fetches engine_bg.wasm next to engine.js; or init({ module_or_path: url | bytes | WebAssembly.Module })
for (const font of fonts) Engine.add_font(font); // Uint8Array per TTF/OTF/TTC file, for every Engine
const engine = new Engine();

engine.set_source("/main.typ", "= Hello\nInline math $x^2$.");
const { ok, html, diagnostics } = engine.compile_html();

// Paged preview: only the pages whose content changed.
const { pageCount, changed } = engine.compile_svg_changed(); // changed: { index, hash, width, height, svg }[]
```

The base fonts (Libertinus Serif regular, bold and italic, New Computer Modern Math, DejaVu Sans Mono; ≈ 2.6 MB, licenses in `dist/fonts/NOTICE`) ship in `dist/fonts/`. `import { baseFonts } from "@typstream/engine-wasm/fonts"` gives their URLs, written as `new URL("./fonts/…", import.meta.url)` so bundlers emit them as assets.

## Lazy fonts

Scripts the base fonts don't cover have **script fonts**, registered without their bytes and downloaded the first time a document uses them (PLAN.md §6.4, #11): Noto Naskh Arabic, Noto Serif Bengali and Noto Serif Devanagari, regular and bold (47–79 KB brotli each, OFL, `dist/fonts/LICENSE-Noto.txt`). Libertinus Serif already covers Latin, Greek, Cyrillic and Hebrew. `scriptFonts` from `@typstream/engine-wasm/fonts` lists them as `{ url, file, family, scripts, info }`, where `info` is Typst's `FontInfo` for each face (family, style, coverage) as JSON, computed at build time.

```ts
import { scriptFonts } from "@typstream/engine-wasm/fonts";

const ids = scriptFonts.map((font) => Engine.register_font(font.info)); // in the font book, no bytes yet
const r = engine.compile_svg_changed(); // r.missingFonts: ids of registered fonts this compile wanted
for (const id of r.missingFonts) Engine.load_font(id, await fetchBytes(scriptFonts[ids.indexOf(id)].url));
engine.compile_svg_changed(); // now with them
```

Typst selects a registered face by family or for fallback (the first font covering the text) exactly as if it were loaded. Without its bytes, `World::font` records the miss and Typst moves on to the next family or draws tofu, so the compile still succeeds. The miss is reported on cached compiles too, because comemo replays font lookups when it validates them. `@typstream/engine`'s adapter does this for you in the worker and recompiles once the font arrives.

For other fonts (CJK, say), compute the `info` to register them with (`FontSource.info` in `@typstream/core`) once, at build time, with the version of this package your app ships: `Engine.font_info(bytes)` after `initSync`.

```js
// font-info.mjs: node font-info.mjs font.ttf prints the font's info
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Engine, initSync } from "@typstream/engine-wasm";

const require = createRequire(import.meta.url);
initSync({ module: readFileSync(require.resolve("@typstream/engine-wasm/engine_bg.wasm")) });
console.log(Engine.font_info(readFileSync(process.argv[2])));
```

`scripts/fonts.mjs` does the same for the build's own registry (`scriptFonts`); it's in this repository, not in the published package.

In Node or a worker that already has the bytes: `initSync({ module: bytes })`.

## API

| | |
|---|---|
| `new Engine()` | An empty project with an empty `/main.typ`. |
| `Engine.add_font(bytes)` | Adds a font file for every engine in the instance; returns its number of faces (a TTC has several). Adding a file again does nothing. |
| `Engine.font_info(bytes)` | Typst's `FontInfo` for each face of a font file, as JSON. |
| `Engine.register_font(info)` | Registers a font file from its info, without bytes; returns its id. The same info gets the same id. |
| `Engine.load_font(id, bytes)` | Gives a registered font its bytes. Throws unless they are the file the info came from. |
| `set_source(path, text)` | Sets a source file. `/main.typ` is the entry point. Existing sources are updated incrementally. |
| `set_file(path, bytes)` / `remove_file(path)` | Binary files (images, data). `/main.typ` can't be removed. |
| Package paths | `@preview/cetz:0.5.3/src/lib.typ` (a spec, then a path) is a file of that package, rooted at it, so `#import "@preview/cetz:0.5.3"` reads its `typst.toml` and entry point. A package with nothing mounted is "package not found". `@typstream/engine`'s server fetches and mounts allowed packages (#25). |
| `set_inputs({ key: "value" })` | `sys.inputs`. Values must be strings. |
| `compile_html()` | `{ ok, html?, diagnostics, ms, missingFonts }`. Every compile lists `missingFonts`: registered fonts it wanted but had no bytes for. HTML text is drawn by the browser, so only `html.frame`s need fonts. |
| `compile_svg_changed()` | `{ ok, pageCount?, changed?, diagnostics, ms, compileMs, exportMs }`. A failed compile keeps the previous pages as the baseline. Each changed page has its `width` and `height` in points and a `hash` (32 hex digits) of its frame. Frame hashes include source spans, so the same text parsed afresh or reparsed incrementally can hash differently. |
| `reset_pages()` | The next `compile_svg_changed` sends every page. |
| `check_paged()` | `{ ok, pageCount?, diagnostics, ms }`: a paged compile without export, for validation. Leaves the changed-page baseline alone. |
| `compile_pdf()` | `{ ok, pdf?, pageCount?, diagnostics, ms }`. Needs the `pdf` cargo feature, which is on by default. |
| `Engine.features()` | `["html", "svg", "pdf"]`; `"pdf"` is missing from builds without that feature. |
| `Engine.memory_bytes()` | Wasm linear memory in bytes. |

Paths are virtual and absolute (`/img/a.png`); invalid ones throw. Methods that compile never throw for document errors; those come back as diagnostics.

A `Diagnostic` has the shape of `@typstream/core`'s, with `/main.typ` as the document: `{ severity, span, message, hints, trace, file?, source: "typst" }`. Spans are `{ from, to }` in **UTF-16 code units**, so `source.slice(span.from, span.to)` is the offending text. For a problem in another file, `span` is the nearest call site in `/main.typ` (or `null`) and `file: { path, span }` is the original location. `trace` lists the calls, show rules and imports the error came through, innermost first; each item has a span only where it is in `/main.typ`. The warning Typst emits on every HTML compile ("html export is under active development") is dropped.

Things to know:
- **Every compile calls `comemo::evict(2)`.** Typst's memoization cache would otherwise grow by ~4 MiB per compile; with it, memory stays flat over hundreds of streaming compiles.
- Fonts, the memoization cache and memory are **global to the wasm instance**, shared by every `Engine` in it. Wasm memory never shrinks; recycle the worker to give it back.
- No packages, network or filesystem: a document can read only what was set on the engine.
- `datetime.today()` is the local date, as in the Typst CLI.
- PDF is in the build (+0.34 MB brotli), so an export reuses the preview's warm compile instead of loading and warming a second engine (#18, PLAN.md §6.4). `cargo build --no-default-features` leaves it out.

## Building

Needs Rust ≥ 1.92 with `wasm32-unknown-unknown`, `wasm-bindgen-cli` at exactly the version in `Cargo.lock` (0.2.129), and binaryen's `wasm-opt`.

```bash
pnpm build        # ./build.sh: cargo release build, wasm-bindgen --target web, wasm-opt -Oz, base and script fonts → dist/
                  # (script fonts are downloaded from notofonts at a pinned commit and checked by SHA-256)
                  # (skipped when dist/ was built from the same inputs; FORCE=1 rebuilds)
pnpm test         # vitest, against the existing dist/
pnpm turbo run test --filter=@typstream/engine-wasm   # from the repo root: build if needed, then test
pnpm size         # brotli-11 size of the wasm; budget 6.3 MB
```

The tests use Typst's bundled fonts from the `typst-assets` crate (found with `cargo metadata`) and compare against the native `typst` CLI 0.15.1, which must be on `PATH`. They check that HTML and every SVG page are identical to native output.
