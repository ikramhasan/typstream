# Custom Typst 0.15.1 wasm engine: Phase 0 results

Date: 2026-10-26 · Machine: Apple M1 Pro, macOS 27.0 · Typst `=0.15.1` (typst, typst-html, typst-layout, typst-svg, typst-pdf)

## Toolchain

| tool | version |
|---|---|
| rustc / cargo | 1.99.1 (stable). **Typst 0.15.1 needs Rust ≥ 1.92**; the 1.91 that was installed could not build it |
| target | wasm32-unknown-unknown |
| wasm-bindgen (crate + CLI) | 0.2.129 (`cargo install wasm-bindgen-cli --version 0.2.129 --locked`) |
| wasm-opt (binaryen) | 133 (Homebrew) |
| twiggy | 0.8.0 |
| node | v25.5.0 |
| brotli / gzip | brotli 1.2.0 `-q 11` / Apple gzip `-9` |

Release profile: `opt-level="z"`, `lto=true`, `codegen-units=1`, `panic="abort"`, `strip=true`.
wasm-opt is run with `--enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue` (these are the features rustc 1.99 emits by default).

## Layout

```
custom-engine/
  Cargo.toml, Cargo.lock, src/lib.rs   the crate (features: svg, pdf; html is always on)
  build.sh                             builds the variants into dist/<variant>/ and adds a row to dist/sizes.tsv
  smoke.mjs                            Node smoke test, timings and memory  (node smoke.mjs <variant>; MEM=0 skips memory; WASM=typstream_engine_bg.O3.wasm)
  slim/Cargo.toml                      same src/lib.rs, plus [patch.crates-io] for hypher + two-face (experiment)
  patches/hypher-0.1.8, patches/two-face-0.4.5   the patched dependency copies
  tools/syntax-dump/                   writes a reduced syntect dump (used to make the empty two-face set)
  tools/attribute.py                   adds up code and .rodata per crate from a wasm-ld --Map file
  dist/<variant>/                      typstream_engine.js (--target web glue), .d.ts,
                                       typstream_engine_bg.wasm (wasm-opt -Oz, the one to load),
                                       typstream_engine_bg.O3.wasm, typstream_engine_bg.raw.wasm
  logs/                                smoke/timing outputs quoted below
```

## Sizes

Bytes. raw = straight out of wasm-bindgen. Oz/O3 = after `wasm-opt -Oz` / `-O3`. gz = gzip -9, br = brotli -q 11.

| variant | rust opt | raw | -Oz | -O3 | -Oz gz | **-Oz br** | -O3 gz | -O3 br | JS glue | glue gz |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `html` | z | 21,045,206 | 19,323,214 | 19,789,603 | 7,595,360 | **5,847,324** | 7,629,155 | 5,840,462 | 14,708 | 3,608 |
| `html-svg` | z | 21,130,389 | 19,395,748 | 19,865,246 | 7,622,531 | **5,849,802** | 7,659,807 | 5,864,936 | 14,794 | 3,642 |
| `full` (html+svg+pdf) | z | 22,961,892 | 20,959,771 | 21,488,540 | 8,153,858 | **6,209,317** | 8,193,605 | 6,200,360 | 15,202 | 3,722 |
| `html-svg` | s | 23,190,883 | 21,268,524 | 21,791,260 | 8,276,140 | 6,205,477 | 8,307,212 | 6,202,128 | 14,794 | 3,642 |
| `html-svg` | 3 | 26,096,109 | 24,085,478 | 24,719,210 | 9,160,395 | 6,679,577 | 9,181,626 | 6,673,077 | 14,794 | 3,642 |
| `slim-html` (patched deps) | z | 18,984,295 | 17,262,318 | 17,728,704 | 5,937,859 | **4,274,503** | 5,972,214 | 4,277,885 | 14,708 | 3,609 |
| `slim-html-svg` (patched deps) | z | 19,069,477 | 17,334,829 | 17,804,320 | 5,964,579 | **4,291,708** | 6,001,169 | 4,295,354 | 14,794 | 3,642 |

What this shows:
- **Leaving out SVG export saves almost nothing (about 2.5 KB brotli).** `typst-svg` is a thin layer. Layout, fonts, images and the SVG/PDF-image decoders are all linked by `typst`/`typst-library` whatever exporters you use, and `typst` itself always depends on `typst-layout` and `typst-html`.
- **PDF export costs about 360 KB brotli** (krilla, subsetter, write-fonts, typst-pdf). That is worth lazy-loading or doing on the server, but it is not the main cost.
- Of the ~5.85 MB brotli for HTML+SVG, about 75% is the shared compiler and standard library. Gating exporters cannot remove it.
- `wasm-opt -Oz` vs `-O3`: the brotli sizes are about the same and the speed is about the same (below). **The Rust `opt-level` is what matters**: `3` is +830 KB brotli (+14%) and about 35% faster, `s` is +356 KB and about 25% faster.
- Compared with the PLAN numbers for typst.ts (7.1–7.6 MB brotli), the custom `html-svg` build is **5.85 MB brotli** (−1.3 to −1.7 MB), and **4.29 MB** with the two patched dependencies.

## What else could be cut

**No feature gates exist.** `typst` 0.15.1, `typst-library`, `typst-layout`, `typst-html`, `typst-eval` and `typst-realize` have **no `[features]` table**. `typst-assets` has only `fonts`, which is off. The heavy dependencies are all pulled in with their default features:
- `hayagriva` (default `archive` + `biblatex`)
- `hypher` (default `full`, all languages)
- `two-face` (full syntax set)
- `wasmi` (the `plugin()` function)
- `image` (png/jpeg/gif/webp)
- `usvg` and `hayro-*` (SVG and PDF *images*)

Cargo features only add, so a downstream crate cannot turn any of these off.

### Top contributors (full variant)

Method: `wasm-ld --Map` from a non-LTO build (`target/analysis-map`, `python3 tools/attribute.py target/analysis-map/link.map`). Code and `.rodata` are attributed to the crate whose object file contains them. Code size is ~10% above the LTO build. `.rodata` is 9.64 MB in both builds. Cross-checked with `twiggy top` on an unstripped LTO build: `.rodata` is the largest item at 9.6 MB = 42% of code+data. In the LTO build, `typst_library` is the largest code crate, followed by citationberg, wasmi and hayagriva.

| # | crate | code | rodata | total | % |
|---|---|---:|---:|---:|---:|
| 1 | typst_library | 3099 K | 913 K | 4012 K | 16.7% |
| 2 | hayagriva (bibliography; ~2.8 MB of embedded CSL styles/locales as CBOR) | 806 K | 2853 K | 3659 K | 15.3% |
| 3 | hypher (hyphenation tries, all languages) | 7 K | 1166 K | 1173 K | 4.9% |
| 4 | icu_collator (+baked data, used by hayagriva only) | 53 K | 1098 K | 1151 K | 4.8% |
| 5 | two_face (syntect syntax-set dump) | 8 K | 921 K | 928 K | 3.9% |
| 6 | citationberg (CSL) | 886 K | 13 K | 899 K | 3.8% |
| 7 | wasmi (Typst plugins) | 750 K | 40 K | 790 K | 3.3% |
| 8 | hayro_interpret (PDF-as-image) | 377 K | 273 K | 650 K | 2.7% |
| 9 | typst_layout | 543 K | 58 K | 601 K | 2.5% |
| 10 | krilla (PDF export) | 499 K | 41 K | 540 K | 2.3% |
| 11 | skrifa (fonts) | 484 K | 31 K | 516 K | 2.2% |
| 12 | regex_syntax | 144 K | 314 K | 458 K | 1.9% |
| 13 | regex_automata | 382 K | 23 K | 406 K | 1.7% |
| 14 | wasmparser (Typst plugins) | 328 K | 43 K | 371 K | 1.5% |
| 15 | icu_segmenter (line breaking) | 22 K | 333 K | 354 K | 1.5% |
| 16 | typst_svg | 72 K | 268 K | 340 K | 1.4% |
| 17 | hayro_syntax | 298 K | 17 K | 315 K | 1.3% |
| 18 | usvg | 296 K | 19 K | 315 K | 1.3% |
| 19 | rustybuzz | 206 K | 108 K | 314 K | 1.3% |
| 20 | typst_html | 213 K | 57 K | 270 K | 1.1% |

By feature area. Raw bytes are measured. Brotli savings are **measured** where a variant was built and **estimated** otherwise. Estimates assume code compresses about 4× with brotli, and use the brotli size of each data blob measured separately.

| area | raw code | raw rodata | brotli saving if removed | gate? / what it would take |
|---|---:|---:|---:|---|
| Hyphenation (hypher, 48 languages) | 0.01 MB | 1.17 MB | **~0.77 MB (measured, with two-face)** | No Typst gate. **Patched `hypher` with `default=["alloc","english"]` works with no Typst change** (typst-layout only calls `Lang::from_iso` and `hyphenate`). Per-language brotli: en 20 KB, de 142 KB, fr 5 KB, es 8.5 KB, bn/hi <1 KB. Pick a set, or patch hypher to load tries from JS at runtime. |
| Syntax highlighting (two-face dump + syntect) | 0.32 MB | 0.94 MB | **~0.80 MB (measured, with hypher)**; +~0.08 MB more if syntect code is removed too (estimate) | No gate. **Patched `two-face` with an empty dump works with no Typst change**: raw blocks still render, without colours. A curated subset (~15 languages) needs the dump rebuilt from two-face's `.sublime-syntax` sources with `SyntaxSetBuilder`. Subsetting the pre-linked set via `into_builder()` panicked in syntect. |
| Bibliography (hayagriva, citationberg, biblatex, icu_collator+data, url/idna, quick_xml) | 1.98 MB | 4.08 MB | ~0.9–1.2 MB (estimate; the CSL archive is 3.1 MB raw but only 145 KB brotli) | No gate, and stubbing hayagriva is not practical: `typst-library` uses `hayagriva::archive::ArchivedStyle`, `citationberg` types, etc. Needs a typst-library patch: `#[cfg]` out `model/bibliography.rs` and `cite`, plus their registration in the global scope and the show rules. A cheaper partial patch: hayagriva with only IEEE + en-US in the archive, about 2.8 MB raw but only ~0.13 MB brotli. |
| Wasm plugins (wasmi, wasmparser) | 1.15 MB | 0.09 MB | ~0.3–0.35 MB (estimate) | No gate. Patch typst-library `foundations/plugin.rs` (the `plugin` func and `PluginInstance`) behind a cfg. Safe to drop only if no allowlisted package uses a wasm plugin. Several packages do (e.g. diagraph, jogs), and recent CeTZ versions may too. **Not checked**: audit the allowlist before cutting. |
| PDF-as-image (hayro-*) | 1.24 MB | 0.32 MB | ~0.4 MB (estimate) | No gate. `image("x.pdf")` support. Patch typst-library `visualize/image/pdf.rs` and the typst-svg/typst-layout call sites. |
| SVG images (usvg, resvg, tiny_skia, roxmltree, fontdb) | 0.94 MB | 0.06 MB | ~0.25 MB (estimate) | No gate. Probably keep it: SVG images are useful in edu content. |
| Raster image decoders (image, png, zune_jpeg, gif, webp, moxcms) | 0.54 MB | 0.11 MB | ~0.15 MB (estimate) | No gate. In the HTML target images could be passed through as `<img>`, but typst-library still decodes them for size and metadata. |
| PDF export (krilla, typst-pdf, subsetter, write-fonts) | 1.13 MB | 0.08 MB | **0.36 MB (measured: full − html-svg)** | Already a crate-level feature of ours. |
| Data loading (toml, yaml, csv, cbor, json) | 0.31 MB | 0.02 MB | ~0.08 MB (estimate) | No gate. Small. |
| ICU segmenter/properties (line breaking) | 0.07 MB | 0.33 MB | – | Needed for layout. |
| Core compiler (typst_*, comemo, ecow, codex) | 4.37 MB | 1.35 MB | – | Needed. |

**Summary of cuts:**
- **Patching only dependencies (no Typst fork): 5.85 → 4.29 MB brotli, −27%, measured.** This build has English-only hyphenation and no code highlighting.
- With a small `#[cfg]` patch to typst-library for bibliography, plugins and PDF-as-image, a further ~1.6–1.9 MB brotli is plausible (estimate), which would put the engine at **~2.4–2.7 MB brotli**.
- None of this was verified beyond the two measured patches.

## Node timings (html-svg, Rust opt-level z, wasm-opt -Oz, unless noted)

Document: generated, 10.4 KB of Typst, **6 pages** A4 (page count matches native `typst compile`). 13 sections, each with a heading, inline and display math, a 4-column table with math, `#lorem(40)`.
Each target runs in a **fresh wasm instance** (the glue module is re-imported) because comemo's cache is global per instance.
`ms` is measured inside the engine (`performance.now()` around compile + export). Wall time including JS marshalling is within 0.1–0.5 ms of it.

| | HTML | SVG (6 pages) |
|---|---:|---:|
| first compile, fresh instance (fonts already added) | 32 ms | 101–124 ms |
| same source again (cache hit + export) | 0.9 ms | 35 ms (cost of SVG serialization of all 6 pages) |
| +1 appended paragraph, first warm recompile | 21–22 ms | 45 ms |
| +1 paragraph, median of 15 successive appends | **19–20 ms** | **48–49 ms** |
| wasm memory after these 17 compiles (no evict) | 74 MiB | 86.5 MiB |

The very first compile in a fresh instance on a *small* doc with a highlighted raw block took 136 ms (this includes one-off deserialization of the syntect set).
`WebAssembly.compile` takes 20–36 ms and `initSync` 4–8 ms in Node; V8 compiles lazily, so browsers will differ. Memory after adding the 5 fonts: 15.5 MiB.

Optimisation levels (3 runs each, medians of "+1 para median(15)", `logs/timings-optlevels.txt`):

| build | brotli | HTML warm | SVG warm | HTML first | SVG first |
|---|---:|---:|---:|---:|---:|
| opt z, -Oz | 5.85 MB | 19.1 ms | 48.8 ms | 32 ms | 101 ms |
| opt z, -O3 | 5.86 MB | 18.9 ms | 49.9 ms | 31 ms | 102 ms |
| opt s, -Oz | 6.21 MB | 15.2 ms | 34.9 ms | 26 ms | 73 ms |
| opt 3, -Oz | 6.68 MB | 12.5 ms | 32.9 ms | 27 ms | 64 ms |
| opt 3, -O3 | 6.67 MB | 12.9 ms | 32.5 ms | 26 ms | 63 ms |

The `slim-html-svg` build has the same timings as `html-svg`: HTML 21 ms and SVG 48 ms warm.

## Memory (html-svg, 200 compiles of a growing document)

Streaming-like workload: each compile appends a few words to the 6-page document, with a new paragraph every 10 compiles. Values are MiB of wasm linear memory at compiles 50 / 100 / 150 / 200 (`logs/smoke-html-svg.txt`).

| target | policy | 50 | 100 | 150 | 200 | avg ms/compile |
|---|---|---:|---:|---:|---:|---:|
| HTML | no evict | 198 | 383 | 569 | **756** | 66.2 |
| HTML | `evict(10)` every 10 compiles | 198 | 382 | 422 | 425 | 27.3 |
| HTML | `evict(10)` after every compile | 56 | 57 | 57 | **59** | 15.6 |
| HTML | `evict(2)` after every compile | 27 | 27 | 27 | **27** | 16.4 |
| SVG | no evict | 211 | 414 | 630 | **860** | 83.2 |
| SVG | `evict(10)` every 10 compiles | 210 | 412 | 476 | 506 | 58.8 |
| SVG | `evict(10)` after every compile | 62 | 65 | 69 | **73** | 46.9 |
| SVG | `evict(2)` after every compile | 32 | 32 | 33 | **34** | 46.7 |

- Without eviction, the comemo cache grows by about 3.7 MiB (HTML) to 4.3 MiB (SVG) per compile. That is the typst.ts #895 failure mode: 1 GB after about 250 compiles.
- **`comemo::evict(max_age)` counts *evict calls*, not compiles.** An entry is dropped after `max_age` evict calls without a cache hit. "evict(10) every 10 compiles" therefore keeps entries for about 100 compiles, which is why it looks no better than no eviction until compile 100.
- **Call `evict` after every compile.** `typst watch` does `evict(10)` per compile. With that, memory stays flat at 27–73 MiB, and compiles also get faster: less allocator growth, and no hashing over a huge cache. `evict(2)` costs no measurable speed in this streaming workload.
- Wasm linear memory never shrinks. `memory_bytes()` is a high-water mark, so a spike from one big compile stays reserved until the worker is recycled.

## JS API as built

`dist/<variant>/typstream_engine.js` is an ES module made by `wasm-bindgen --target web`:
- `default export init(module_or_path?)`: with no argument it fetches `typstream_engine_bg.wasm` (the `-Oz` file) relative to `import.meta.url`.
- Also exports `initSync({ module })` and `class Engine`.

The `.d.ts` includes the result types:

```ts
export type Diag = { severity: "error" | "warning"; message: string; hints: string[]; start?: number; end?: number; file?: string };
export type HtmlResult = { ok: boolean; html?: string; diagnostics: Diag[]; ms: number };
export type SvgResult  = { ok: boolean; pages?: string[]; diagnostics: Diag[]; ms: number };
export type PdfResult  = { ok: boolean; pdf?: Uint8Array; diagnostics: Diag[]; ms: number };
export class Engine {
  constructor();
  add_font(bytes: Uint8Array): number;           // faces added (TTC → several)
  set_source(path: string, text: string): void;   // "/main.typ" = entry; existing sources updated via Source::replace; throws on invalid path
  set_inputs(json: string): void;                // sys.inputs; JSON object; non-string values are stringified; throws on bad JSON
  compile_html(): HtmlResult;
  compile_svg(): SvgResult;                      // always present; without "svg": {ok:false, diagnostics:[{severity:"error", message:"feature not built: svg", hints:[]}], ms:0}
  compile_pdf(): PdfResult;                      // same for "pdf"
  evict(max_age: number): void;                  // comemo::evict(max_age); global per wasm instance
  memory_bytes(): number;                        // wasm linear memory size (bytes)
  // extras, not in the original contract:
  set_file(path: string, bytes: Uint8Array): void; // binary virtual files (images, data)
  remove_file(path: string): void;
  static features(): string[];                   // e.g. ["html","svg"]
  free(): void; [Symbol.dispose](): void;        // wasm-bindgen; call free() to release an Engine
}
```

Differences from the requested contract:
- Methods for features that weren't built are **present** and return the "feature not built" result.
- `Diag` has an extra optional `file` (the virtual path) when the span is in a file other than `/main.typ`.
- Results are plain JS objects, not classes.

Other behaviour:
- `start`/`end` are **UTF-8 byte offsets** (Typst's native unit), not UTF-16. JS must convert before slicing a string that contains non-ASCII text.
- Hint spans are dropped; only hint text is returned.
- `today()` is fixed at 2026-01-01.

## Gotchas / notes

1. **Rust ≥ 1.92** is required by typst 0.15.1.
2. HTML compile: build the library with `Library::builder().with_features([Feature::Html].into_iter().collect()).build()`, then call `typst::compile::<typst_html::HtmlDocument>(&world)` and `typst_html::html(&doc, &HtmlOptions::default())`.
3. Even with `Feature::Html` enabled, every HTML compile emits the warning *"html export is under active development and incomplete"* (no span, 3 hints). The adapter should filter it.
4. The HTML target emits span-carrying warnings such as "page set rule was ignored", "grid was ignored", "h was ignored" and "pagebreak was ignored". `#grid` produces **nothing** in HTML output. This confirms the PLAN's need for the `html-compat` prelude.
5. Inline/display math becomes `<math>` / `<math display="block">` MathML. Figures, tables and refs become `<figure id>`, `<table>`, `<figcaption>` and `<a href="#tab">Table 1</a>`. Headings are shifted down one level (`=` → `<h2>`).
6. Typst 0.15 path APIs:
   - File ids are made with `RootedPath::new(VirtualRoot::Project, VirtualPath::new("/main.typ")?).intern()`.
   - Diagnostic spans are `DiagSpan`; use `WorldExt::range` to get byte ranges.
   - `PagedDocument` lives in `typst_layout`, `HtmlDocument` in `typst_html`.
7. rayon on `wasm32-unknown-unknown` falls back to single-threaded execution. Nothing panicked; no special handling was needed.
8. comemo's cache is **process-global (per wasm instance)** and shared by all `Engine`s. Evicting from one Engine evicts for all. A fresh instance needs re-importing the glue with a cache-busting query, or a new Worker.
9. `wasm-bindgen` CLI must match the crate version exactly. Both are pinned to 0.2.129 by Cargo.lock.
10. Build time: ~1.5–2.5 min per variant on an M1 Pro (fat LTO, one CGU), plus ~1 min for the two wasm-opt passes. The first build has ~290 crates.

## Not verified

- **Loading in a real browser.** Only Node was used: `initSync({module})` plus the async `init({module_or_path: bytes})` path. The `fetch(new URL(...))` default path was not exercised.
- Browser timings. V8 in Chrome should be close to Node; Safari/JSC and Firefox may differ.
- PDF content correctness beyond `%PDF-1.7` and a size of ~38 KB. HTML output was not diffed against native `typst compile --features html`; only spot-checked.
- Native vs wasm SVG output was compared on **page count only** (smoke doc 1 = 1, bench doc 6 = 6).
- Brotli savings for bibliography, plugins and image stacks are **estimates**. No Typst patch was built.
- The `slim` hypher patch silently disables hyphenation for all languages except English. Native `typst` hyphenates German. Page counts still matched for the test docs.
- Memory behaviour under very large documents, and any memory cap or OOM behaviour.
