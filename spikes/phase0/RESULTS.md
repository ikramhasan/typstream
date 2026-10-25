# Phase 0 — Engine bake-off results

Date: 2026-10-26 · Machine: Apple M1 Pro, 16 GB · Browsers (Playwright 1.64.1): Chromium 156, Firefox 157, WebKit 27.2
Engines:
- **typst.ts** — `@myriaddreamin/typst-ts-web-compiler` + `typst-ts-renderer` **0.8.0-rc3** (Typst 0.15.0-rc.1). Paged output: incremental vector deltas, merged and patched into the DOM by the renderer on the main thread.
- **typst-wasm** — `typst-wasm` **1.0.0** (Typst 0.15.0, jco component). HTML and SVG. Tested three ways: its own worker backend (needs cross-origin isolation), JSPI on the page's main thread, and JSPI hosted inside our own worker (`typstwasmw`).
- **custom** — our own wasm-bindgen build of **Typst 0.15.1** (`custom-engine/`, variant `html-svg`, `wasm-opt -Oz`) in a dedicated worker. HTML and full SVG pages, plus `comemo::evict`.

How to reproduce: `cd harness && npm i && node build.mjs && node run.mjs [filters…]`, then `node table.mjs` / `node summarize.mjs [filters…]`. Raw JSON per run is in `harness/results/`.

## Method

- Documents: a generated worksheet (headings, `lorem`, inline + display math with equation numbering, an enumerated list, a figure with a table, a label and a `@ref`), calibrated with native typst to **1, 5 and 20 A4 pages** (1 048 / 5 119 / 22 600 chars).
- **Streaming** = compiling prefixes cut at blank lines (what the healer hands the compiler after each completed block), at most 40 evenly spaced steps per document. The timed compile is measured **inside the worker**; roundtrip includes `postMessage`; "render" is main-thread work to put the output into the DOM.
- Each run uses a fresh browser context (cold HTTP cache). Assets are served brotli-11 compressed from localhost, so local "download" is mostly `WebAssembly.compileStreaming`.
- **Throttled** profile (Chromium only): 20 Mbps down / 40 ms RTT network + 4× CPU throttling via CDP. Important caveat, visible in the data: **CDP CPU throttling only slows the main thread, not workers.** The JSPI-on-main-thread row (42/66 ms vs 8/12 ms locally) shows the real 4–5× effect. Worker compile times for low-end devices should therefore be estimated as roughly **4–6× the local numbers**.
- Memory: 200 compiles of a 5-page document with a changing last paragraph; wasm linear memory sampled every 20 compiles.

## Download size (brotli-11, what the user downloads)

| Asset | Raw | Brotli |
|---|---|---|
| typst.ts web compiler wasm 0.8.0-rc3 | 30.2 MB | **7.74 MB** |
| typst.ts renderer wasm 0.8.0-rc3 | 1.28 MB | 0.37 MB |
| typst-wasm 1.0.0 engine core (HTML+SVG+PNG+PDF) | 22.8 MB | **6.22 MB** |
| custom `html` (Oz) | 19.3 MB | **5.83 MB** |
| custom `html-svg` (Oz) | 19.4 MB | **5.86 MB** |
| custom `full` = html+svg+pdf (Oz) | 21.0 MB | 6.20 MB |
| custom `slim-html-svg` (English-only hyphenation, no syntax-highlight set, via `[patch.crates-io]` on two dependencies, not Typst itself) | 17.3 MB | **4.29 MB** |
| Fonts: Libertinus Serif R/B/I + NewCM Math + DejaVu Sans Mono | 2.6 MB | **1.45 MB** |

The format exporters are small: SVG adds ~3 KB brotli and PDF ~360 KB on top of HTML. Typst's crates have **no Cargo feature gates**, so everything else is linked regardless. Largest contributors, attributed from a linker map:

| Crate | Raw size | What it is |
|---|---|---|
| typst_library | 4.0 MB | the standard library |
| hayagriva | 3.7 MB | bibliography; CSL data compresses to ~145 KB brotli |
| hypher | 1.17 MB | hyphenation dictionaries |
| icu_collator | 1.15 MB | bibliography sorting |
| two_face | 0.93 MB | syntax-highlighting definitions |
| citationberg | 0.9 MB | bibliography styles |
| wasmi | 0.79 MB | Typst plugins |

Size options:
- **Measured:** patching hypher (English only) and two_face (empty set) saves **1.56 MB brotli (−27%)**. It costs non-English hyphenation and code colouring. Per-language hyphenation is tiny (en 20 KB, de 142 KB, bn/hi under 1 KB brotli), so a curated language set is cheap.
- **Estimated, not built:** `#[cfg]` patches to typst-library for bibliography (~0.9–1.2 MB), plugins (~0.3 MB, if no allowlisted package needs them) and PDF-as-image (~0.4 MB). These could reach roughly **2.4–2.7 MB brotli**, but would mean maintaining a small Typst patch set.
- Rust `opt-level`: `z` is smallest. `s` costs +356 KB and is ~25% faster; `3` costs +830 KB and is ~35% faster in Node. `wasm-opt -Oz` and `-O3` are equivalent.

See `custom-engine/RESULTS.md` for details.

At 20 Mbps the engine download takes 2.4–3.4 s, plus about 0.8 s for fonts.

## Latency (ms; see `results-table.md` for every run)

Streaming compile p50 / p90, measured in the worker:

| Engine · format | Chromium 5p | Chromium 20p | Firefox 20p | WebKit 20p | 20p main-thread render p50 | 20p warm recompile |
|---|---|---|---|---|---|---|
| **custom · html** | **5 / 8** | **22 / 47** | **21 / 35** | **17 / 28** | 2–4 | **2** |
| custom-slim · html (4.29 MB) | 5 / 7 | 21 / 44 | 22 / 35 | 16 / 27 | 2–4 | 2 |
| typst.ts · paged (incremental) | 5 / 9 | 21 / 39 | 26 / 58 | 24 / 44 | 4 (Ch) · 17 (Fx) · 6 (WK) | 6–9 |
| typst-wasm · html (JSPI in our worker) | 9 / 17 | 35 / 71 | 32 / 51 | 25 / 41 | 2–3 | 4–5 |
| typst-wasm · html (own worker backend, COI) | 10 / 15 | 34 / 63 | 28 / 68 | 33 / 49 | 2–4 | 4–6 |
| custom · svg (all pages every time) | 20 / 33 | 86 / 161 | 96 / 164 | 81 / 140 | **58 (Ch) · 77 (Fx) · 146 (WK)** | 113–129 |
| typst-wasm · svg (all pages every time) | 41–44 / 70 | 165–183 / 301–326 | 188–255 | 139–158 | 53–144 | 115–234 |

Cold start (local, cached nothing): wasm `compileStreaming` 80–350 ms depending on browser (Firefox slowest), instantiate 3–20 ms, fonts 20–75 ms, first compile of a 1-page document 3–45 ms.

Takeaways:
1. **Streaming latency is fine for chat-sized documents on every engine.** Worst case p90 at 20 pages is about 70 ms on an M1. On a low-end device (×4–6) that's roughly 0.2–0.4 s per update for 20 pages, which the adaptive throttle in the plan (§6.2) absorbs.
2. **HTML is the cheapest target to render.** Main-thread DOM updates take 1–4 ms even at 20 pages, with zero long tasks.
3. **Full-SVG-per-compile does not scale.** 20 pages of SVG is 5.2 MB of markup each time, causing 22–25 long tasks per run in Chromium and up to 0.5 s renders in Firefox. typst.ts's incremental vector deltas + DOM patching avoid this (3–6 ms render in Chromium and WebKit). A custom build that wants a paged target must **send only changed pages** (hash each page frame, re-export just the changed ones). That's not implemented in this spike.
4. The custom build is the fastest HTML engine: ~1.5× faster than typst-wasm while streaming and 2× on warm recompiles, probably because it avoids jco's component-model copying. This was not profiled.

## Changed-page SVG prototype (paged target without typst.ts)

`Engine.compile_svg_changed()` (custom build, +2 KB brotli) compiles to pages, computes `hash128(page)` for each page (frame hashes are cached by Typst, so this is cheap), and exports SVG **only for pages whose hash changed** since the last successful call. A failed compile keeps the old hashes. The page side keeps one `<div>` per page and replaces only the changed ones. `reset_pages()` starts a new document. Measured with `evict(2)` after every compile (the production setting); numbers without eviction are within noise, except Chromium's roundtrip, noted below.

**Which pages change while streaming** (20-page document, 40 steps, Chromium): `pageCount:changed indices`
```
1:0 2:0,1 2:1 3:1,2 3:2 4:2,3 … 17:15,16 17:16 18:15,16,17 18:17 19:17,18 19:18 20:13,14,15,16,17,18,19 20:19
```
Normally it's the last page, or the last two when content crosses a page break (median 1 per step). Once a reflow reached back 2 pages, and once 7 pages; the cause was not investigated. Those steps cost more, but still only the changed pages are sent.

**Render cost per streaming update, main thread, 20 pages** (ms, p50 / p90 / max):

| Browser | typst.ts (delta + DOM patch) | custom, all pages each time | **custom, changed pages only** | changed-only ÷ typst.ts (p50) |
|---|---|---|---|---|
| Chromium | 3.4 / 5.2 / 5.4 | 57.8 / 115 / 132 | **7.2 / 11.4 / 58** | 2.1× |
| Firefox | 8.4 / 19.3 / 22 | 76.7 / 141 / 155 | **5.3 / 8.7 / 39** | 0.6× (faster) |
| WebKit | 5.1 / 10.8 / 12 | 146 / 263 / 292 | **8.5 / 13.8 / 70** | 1.7× |
| Chromium 4× CPU, 5 pages | 3.8 / 12.6 / 14.6 | 49.5 / 101 / 104 | **16.5 / 24.7 / 29** | 4.4× |

**Worker time per update, 20 pages** (compile + export, p50 / p90): custom changed-only 30–34 / 42–48 ms (compile 21–24 ms + SVG export 6–7 ms) vs typst.ts 18–25 / 31–41 ms. **Full 20-page document, first render** (all pages): custom 45–88 ms vs typst.ts 80–146 ms, so the custom build wins the initial paint.

Long tasks over 50 ms in Chromium: 2 per run (the multi-page reflow steps) vs 23 when sending all pages and 1 for typst.ts.

Verdict:
- **Meets the "within ~2× of typst.ts render cost" bar**: faster in Firefox, 1.7× in WebKit, 2.1× in Chromium.
- Every typical update stays under one frame (5–9 ms).
- The remaining gap is worst-case multi-page reflows (40–70 ms when 7 pages change) and the 4× CPU throttled main thread (16 ms p50).
- Cheap follow-ups:
  1. Only put **visible** pages' SVG into the DOM and queue offscreen pages for idle time. Streaming always happens at the bottom, so reflowed earlier pages are usually offscreen.
  2. Share glyph `<defs>` across pages, since each page's SVG embeds its own glyph outlines.

Observation: in Chromium without eviction, the roundtrip p50 was 4× the in-worker time (137 vs 38 ms at 20 pages). With `evict(2)` it matched the worker time. Firefox and WebKit didn't show this. One more reason to evict after every compile.

## Memory (wasm linear memory, 200 compiles of a changing 5-page document)

| Engine | after 20 | after 100 | after 200 | compile p50 |
|---|---|---|---|---|
| typst.ts paged (no eviction available) | 45 MB | 149 MB | **280 MB** (grows ~1.3 MB/compile, same in all browsers) | 6–9 ms |
| custom html, no eviction | 53 MB | 205 MB | **395 MB** (~1.9 MB/compile) | 6–10 ms |
| custom html, `evict(10)` every 10 compiles | 53 MB | 202 MB | 221 MB (plateau; linear memory never shrinks) | 6–8 ms |
| custom html, `evict(0)` every 5 compiles | 25 MB | 25 MB | **25 MB** | 6.3 ms |
| **custom html, `evict(2)` after every compile** | 21 MB | 21 MB | **21 MB** | **6.5 ms** (faster than without eviction) |
| typst-wasm | not measurable from outside its worker; no eviction API exposed | | | |

This confirms typst.ts issue #895 in real browsers: without eviction, any long session leaks. With **`comemo::evict(2)` after every compile, memory is flat at about 21 MB and compiles get slightly faster.** This is the single biggest technical argument for owning the engine build.

The custom-engine agent's Node test used a *growing* document, the realistic streaming case, and it is harsher. Without eviction: 756 MiB (HTML) and 860 MiB (SVG) after 200 compiles, and compiles slow to 66–83 ms. With `evict(2)` after every compile: 27 / 34 MiB and 16 / 47 ms. Eviction ages entries per **evict call**, not per compile, and the cache is global per wasm instance. **The adapter must call `evict(2)` after every compile.**

## Deployment constraints found

- **typst-wasm's worker backend needs cross-origin isolation** (COOP `same-origin` + COEP `require-corp`) for growable SharedArrayBuffer. That's a heavy requirement for a library embedded in someone else's app: it breaks third-party iframes, OAuth popups and non-CORP images.
- **typst-wasm's JSPI backend works without isolation in all three current engines** (Chromium 156, Firefox 157, WebKit 27.2). But it runs on the calling thread, so it must be hosted inside our own worker (`typstwasmw`), and that works. Older browsers without JSPI would have no backend at all.
- **The custom build and typst.ts need neither** (plain synchronous wasm in a worker).
- typst-wasm only accepts relative project paths (`main.typ`, not `/main.typ`); its error is `invalid-path`, and the wrapper hides the cause.
- typst.ts's `render_svg` panics for normal (single-layout) artifacts. The working path is `render_svg_diff` plus the `patchRoot` DOM patcher from typst.ts's source, which is not exported from npm, so we vendored it.

## Recommendation for PLAN.md

1. **Own the engine: build `@typstream/engine-wasm` from Typst crates (custom build) as the default adapter.**
   - It's the smallest download (5.86 MB brotli with HTML + SVG).
   - It has the fastest HTML streaming and flat memory via `comemo::evict`.
   - It pins Typst 0.15.1 today, and we control upgrades, diagnostics shape and features.
   - It needs no COOP/COEP and no JSPI.
   - Cost: a small Rust crate (about 300 lines for World + bindings) and a CI wasm build.
2. **HTML is the default streaming target** (cheapest compile, ~2 ms DOM updates, accessible).
3. **Paged target: done, see "Changed-page SVG prototype" above.** It's within ~2× of typst.ts's render cost (faster in Firefox) and faster on first paint. **Drop typst.ts: one engine, one wasm download.** Add visible-page-first DOM updates in Phase 2 to cover multi-page reflows and slow CPUs.
4. **Keep typst-wasm as a fallback/reference adapter only.** It's well-made, but it needs COI or JSPI, is ~1.5× slower at HTML, and gives no control over memory.
5. **Hide the ~6–7 MB download** (engine + fonts) behind generation: preload when the user opens the generator, cache it permanently, and offer the server-first hybrid for first visits on slow links. At 20 Mbps it takes about 3 s.

## Environment side effects of this spike

- Typst 0.15.1 needs Rust ≥ 1.92, so the agent ran **`rustup update`**: the default toolchain is now **1.99.1** (was 1.91.1).
- It also installed the `wasm32-unknown-unknown` target, wasm-bindgen-cli 0.2.129, binaryen (wasm-opt 133, Homebrew) and twiggy.
- Playwright Firefox 157 and WebKit 27.2 were downloaded into `~/Library/Caches/ms-playwright`.
- `custom-engine/target/` is a **6.5 GB** build cache and can be deleted.

## Not verified / follow-ups

- Bibliography/plugin `#[cfg]` patches (size estimate only).
- Real low-end hardware. Worker CPU throttling isn't emulated by CDP; the numbers above use a ×4–6 estimate.
- typst-wasm memory behaviour.
- Why some steps reflow up to 7 earlier pages (likely introspection/counter convergence). It's harmless for correctness but drives the worst case.
- The HTML output's visual fidelity: the `html-compat` prelude and MathML rendering across browsers. Both are Phase 3 work.
- Mobile Safari / Android Chrome (wasm memory limits) — not tested.
