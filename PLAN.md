# Typstream — Design & Implementation Plan

> Streaming renderer for LLM-generated **Typst** documents, built for an AI tool that writes
> academic and educational material (worksheets, quizzes, exams, lesson plans, handouts).
> Inspired by [streamdown](reference/streamdown), but Typst is a *compiled language*, not a
> markup format, so most of the hard problems are different.

Status: draft v2 · 2026-10-26 · Target Typst version: **0.15.1** (pinned, see §15)

## Status & decisions

**Where we are:** Phase 0 (engine spikes) and Phase 1 (`@typstream/heal`) are done. Phase 2 (engine) is next. Remaining work is tracked as GitHub issues; [#38](https://github.com/ikramhasan/typstream/issues/38) (pinned, label `roadmap`) lists them in order. `CLAUDE.md` explains how to work in this repo.

**Decision log** (newest first). Record new decisions here in the same PR that acts on them.

| Date | Decision | Why / where |
|---|---|---|
| 2026-10-26 | **Compile oracle (#13):** healed prefixes go through the real compiler in `tools/compile-oracle` (outside `packages/`: heal may not import the engine), in CI's engine job. **88% of corpus stream prefixes compile** after healing (HTML and paged alike), 96% of generated ones. The test allows an explicit list of error classes, each tied to the issue that removes it, and fails below a rate floor (87%) that rises as classes go. | §5.5 "Measured", §11.1 "As built" |
| 2026-10-26 | **Layer 3 is two generic fixers, not the §5.5 table:** *tail cut* (an error in the unsettled tail, or a call site there in its trace, cuts the healed source at that point and re-heals) and *pending reference* (`@x` with no `<x>` becomes a placeholder). Simulated with the PLAN's 2-round limit they reach **99.4%** on the corpus. Heal takes the syntactic cases (a value being typed at the cut, a reference at the cut, incomplete `#let`) so fewer rounds are needed. | §5.5 "Measured", #20 |
| 2026-10-26 | **Corpus format:** `corpus/<set>/<name>.typ`, optional `.stream.jsonl` (`{"t", "text"}` per line), and one `meta.json` per set whose `expect` (`ok` / `error` / `limit`) says what native `typst compile` 0.15.1 must do, checked by `pnpm corpus:validate` with embedded fonts only. Streams without a recording are synthesized from the source (token-sized, seeded). | §11.2 "As built", `corpus/README.md` |
| 2026-10-26 | Heal runs the corpus: every prefix of documents up to 20 KB through the incremental healer, sampled prefixes of larger ones. Bugs the corpus finds but nobody has fixed yet are listed as known, each with a repro that must keep failing. | `packages/heal/__tests__/corpus*.test.ts` |
| 2026-10-26 | **Edits resync** (#5): re-parsing after an edit resumes one checkpoint earlier than before, so it never starts at a checkpoint whose own token the edit can change, and stops at the second matching root checkpoint past the edit. The healer passes known edits (`push`, `applyEdit`) through instead of diffing the whole text. Measured side by side on one (loaded) machine: mid-document 1-char edit at 100 KB ~7–10 ms → ~0.5 ms; per streamed token at 50 KB p50 ~0.25 ms → ~0.03 ms. | §5.2 "As built (resync)" |
| 2026-10-26 | `@typstream/engine-wasm` API as built: changed-page SVG only (no full `compile_svg`), eviction inside every compile, diagnostics in core's `Diagnostic` shape with UTF-16 spans (`/main.typ` = the document), real `today()`, PDF behind a non-default cargo feature. Its own CI job; the other jobs skip it. | §6.1 "As built", #8 |
| 2026-10-26 | **Layering is an allowlist:** a package may import only the packages in its §4.1 "Deps" column. That's stricter than "lower layers only": same-layer deps (node → engine, react → dom) are allowed only where listed, and so are lower-layer ones. One table (`tools/repo/layers.mjs`) drives the dependency-cruiser rules, the package.json check and the changesets fixed group. | §4.1, #3 |
| 2026-10-26 | API reports live in `packages/*/api/`. Untagged exports are `@public`; `@beta` and `@internal` are explicit. Packages are ESM-only for now: attw runs with the `esm-only` profile, so add CJS (and drop the profile) only for a package that needs it (§10.4). | §10.4, #3 |
| 2026-10-26 | The changesets `fixed` group lists only packages that exist, because changesets rejects unknown names. `check:layers` fails when a package marked `fixed` in the table is missing from it. | §10.4, #3 |
| 2026-10-26 | **Worker protocol v1 is in `@typstream/core`** (`protocol.ts`). Compile output arrives only as `document/diagnostics` + `document/artifact` notifications sent before the `compile` response, so client- and server-initiated compiles share one render path. Paged artifacts name the `base` revision their changed pages diff against. Added `document/setFiles`, `shutdown`, `$/cancel`, `$/log`; `resolve/*` is paged-only. | §6.1 "As built" |
| 2026-10-26 | `Diagnostic.span` is nullable and diagnostics from other files carry `file`; `HealHandler` moved from heal to core (the plugin contract needs it); plugins override lint rules by id instead of adding `LintRule` objects (custom rules are `settled` handlers). | §6.1, §8.0 "As built" |
| 2026-10-26 | **CI runs on GitHub Actions** (`.github/workflows/`): lint, types, test (with the oracle), size on every PR and `main`; the 20,000-run property campaign nightly. Perf is **report-only** on PRs: shared runners can't hold the strict budgets, so CI fails only above 3× (`PERF_TOLERANCE=3`). The §11.5 plan of failing on a > 10% regression waits for a dedicated runner or CodSpeed. | #2, §11.5, §11.8 |
| 2026-10-26 | **Low-end devices are out of scope for now.** No Chromebook or Android measurements before launch; budgets are set on a mid-range laptop. | Product call. Revisit after launch. |
| 2026-10-26 | Work is tracked in GitHub issues, each self-contained; open questions are research tasks inside issues, not guesses in this plan. | — |
| 2026-10-26 | `@typstream/heal` is a faithful port of typst-syntax's parser used as a recognizer, tested against Typst's real parser. | §5.2 "As built" |
| 2026-10-26 | Stable offset = last root checkpoint whose first character is followed by another (monotone under appends). | §5.2 |
| 2026-10-26 | **One engine: our own wasm build of Typst 0.15.1** (`@typstream/engine-wasm`) for both HTML and paged output. typst.ts and typst-wasm are dropped as defaults. | §6.1, `spikes/phase0/RESULTS.md` |
| 2026-10-26 | Paged output uses changed-page SVG export (only pages whose frame hash changed). | §6.1, §6.5 |
| 2026-10-26 | The engine calls `comemo::evict(2)` after every compile. | §6.3 |
| 2026-10-26 | HTML is the default streaming target; paged is for print preview. | §0, §6.5 |
| 2026-10-26 | Built as a published toolkit, editor-ready from day one (edits, not appends; LSP-shaped worker protocol; one plugin contract). | §10 |

**Open product questions** (block parts of Phases 2–5, tracked in [#1](https://github.com/ikramhasan/typstream/issues/1)): primary surface (chat vs. document panel), launch languages/scripts, day-one Typst packages, licensing, npm scope.

---

## 0. TL;DR — the key decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | **Use the real Typst compiler (wasm, in a dedicated Web Worker)**, not a hand-written Typst→React parser — **our own wasm build of the Typst crates** is the default adapter (Phase 0 winner: smallest, fastest HTML, flat memory), behind an `EngineAdapter` (§6.1). | Typst documents are programs (`#let`, `#set`, `#show`, loops, packages). A subset parser would silently render the wrong thing. Fidelity is the whole point of moving off Markdown. |
| 2 | **Two render targets from one compile:** `html` (semantic HTML + MathML, default for chat/streaming) and `paged` (SVG pages, print-faithful, default for "document preview"). | Typst 0.15's HTML export produces real `<h2>/<p>/<table>/<math>` and resolves refs (verified locally). It reflows, is accessible, selectable, themeable and animatable. Paged output is what teachers print. |
| 3 | **A four-layer error-correction pipeline**: normalize → incremental *mode-aware* scanner + tail repair → diagnostic-driven semantic fixers → fallback ladder (last-good render / block isolation). | A single unclosed `[` makes the *whole* document fail to compile. Unlike Markdown, there is no graceful degradation for free — we must guarantee a compilable source at every tick or fall back. |
| 4 | **`@typstream/heal` is a pure, zero-dependency TS package** (the `remend` analogue), resumable and O(Δ) per token. | Runs on every token on the main thread; must be testable in isolation with property tests against the real Typst parser as oracle. |
| 5 | **Latest-wins compile scheduler with adaptive throttle + watchdog.** | Compiles take 5–100 ms; tokens arrive every ~20 ms. Never queue stale work; never let an AI-written `while` loop freeze the tab. |
| 6 | **Extensibility through Typst itself first** (a preamble/package layer: `@typstream/edu`, `html-compat`), then TS hooks (repair handlers, diagnostic fixers, render islands, engine adapters). | Teachers' document types are best expressed as Typst functions (`#question`, `#mcq`, `#answer-key`), which the LLM can call and which render identically in every target. |
| 7 | **Prevention beats cure:** ship a prompt kit + lint rules for LLM "Markdown-isms" and a server-side validator/fix loop. | Most real errors we saw are Markdown habits (`# Heading`, `**bold**`, `me@x.com`, `$5 and $10`). |
| 8 | **Built as a published toolkit, editor-ready from day one** (§10): a dependency-free `@typstream/core` (document model, `TextEdit`, spans, source maps, plugin contract) under everything; the source text is the single source of truth and *streaming is just a special kind of edit*; the worker is an LSP-shaped "language service", not a one-off compiler wrapper. | A future Plate-style editor, a CodeMirror source mode, AI "rewrite this section" streams and collaboration all need the same primitives. Getting the contracts right now costs little; retrofitting them later means a rewrite. |

---

## 1. Goals, non-goals, success metrics

### Goals
- Render a Typst document **while it streams**, with no error flashes, no layout thrash, and a final render identical to a one-shot compile of the complete source.
- Work for real teacher content: math (inline/display, aligned, matrices, chemistry), tables, figures with captions & cross-references, numbered questions, answer keys, multi-column worksheets, headers/footers, footnotes, bibliographies, diagrams (CeTZ), multilingual text (incl. RTL and Bengali/CJK).
- One source → chat view, document view, PDF download, `.typ` download.
- Framework-agnostic core; first-class React binding.
- Safe to run untrusted (LLM-authored) Typst in the user's browser.
- Ship as an **open, published family of packages** with a landing page, docs and playground in this repo, usable outside our own product.
- Architecture that a future **visual editor** (Plate-like), a **source editor** (CodeMirror) and **AI-assisted editing** can be built on without rewriting the core.

### Non-goals (v1)
- Building the editor itself. v1 renders; it doesn't edit. But every core contract is designed for editing (§10.3) and has tests that exercise non-append edits.
- Supporting every Typst package. We ship an allowlist.
- Server-only rendering (supported as an adapter, but browser rendering is the main path).

### Success metrics (SLOs, enforced by tests in §11)
| Metric | Target |
|--------|--------|
| Prefix-compile rate (share of stream prefixes whose healed source compiles with zero errors, over corpus) | ≥ 99% (layers 1–3), 100% visible render incl. fallback. Measured (#13): 88.0% with heal alone; 99.4% with simulated layer-3 fixers |
| Final-render equivalence (streamed final frame vs. one-shot compile) | 100% byte-identical HTML / pixel-identical pages |
| Main-thread time per token (heal + scheduling) | p95 < 0.5 ms for 50 KB docs (heal measured: p95 0.2 ms at 40–50 KB) |
| Main-thread long tasks during stream (> 50 ms) | 0 |
| Compile→paint latency for a 5-page doc, warm | p50 < 60 ms, p95 < 150 ms |
| Time to first render (cached wasm) | < 800 ms on mid-range laptop |
| Time to first render (first visit, wasm not cached) | hidden behind LLM generation via preload; otherwise server-first hybrid (§6.4) |
| Core JS (heal + react binding), gzipped | < 20 KB |
| Memory growth over 50 streamed docs in one session | < 10% after GC |

---

## 2. What we borrow from streamdown (and what doesn't transfer)

Studied: `packages/remend` (healing), `packages/streamdown/lib/parse-blocks.tsx`, `index.tsx`, `animate.ts`, plugin types, tests/benchmarks, `scripts/bundle-size.js`, CI.

**Borrow directly**
- **Healing as a separate, zero-dep package** (`remend` → `@typstream/heal`) with per-construct handlers, priorities, per-option toggles, and custom handler API.
- **Single-pass region scan memoized per input** (`remend/src/scan.ts`): every handler asks "is this position code or prose?" in O(1). We extend this into a full Typst *mode stack* and make it **resumable** (streamdown re-scans per string; we can checkpoint because streams are append-only).
- **Stable-prefix reuse** (`parse-blocks.tsx`, `countStableBlocks`): blocks before the last safe boundary never change — reused, not re-lexed. Also its `copyString` trick to avoid V8 substring retention of every intermediate document.
- **Property tests over every prefix** (`remend/__tests__/streaming-properties.test.ts`): build documents from *complete* atoms, cut at every offset, use a real parser as oracle; assert subsequence preservation with bounded tail loss and idempotence. This is the single most valuable testing idea to copy.
- **`mode: "static" | "streaming"`, `isAnimating`, `onAnimationStart/End`, caret, `BlockIncompleteContext`** (lets custom components know they're rendering a still-streaming block).
- **Animation timeline with backlog budget** (`animate.ts`: `MAX_ANIMATION_BACKLOG_MS`, stagger compression) for word fade-in in the HTML target.
- **Plugin packages kept out of core** (`@streamdown/code|math|mermaid`) + bundle-size script with externals; vitest bench files per package; changesets; turbo monorepo.
- **Security posture**: sentinel placeholders for incomplete links (`streamdown:incomplete-link`), link/image hardening.

**Doesn't transfer**
- Markdown degrades gracefully (an unclosed `**` is just text). Typst **fails the whole compile** on one unclosed delimiter. So we need a correctness *guarantee*, a semantic layer and a fallback ladder, not just heuristics.
- Markdown blocks are independent; Typst has **global state** (`#set`/`#show` rules, counters, `#let` bindings, outline, references). We can't render blocks independently — we rely on the compiler's incremental compilation (comemo) instead of block memoization, and do diffing on the *output* (HTML nodes / SVG pages).
- No remark/rehype pipeline; the "components map" idea becomes Typst show rules + render islands (§8.4).

---

## 3. Why streaming Typst is hard — empirical findings

Verified with `typst 0.15.1` on truncated inputs (scratch experiments):

| Truncated input | Result | Implication |
|---|---|---|
| `Hello *bold` | `error: unclosed delimiter` | Must close strong/emph. |
| `*a⏎⏎b*` | 2× unclosed delimiter | Strong/emph are **paragraph-scoped**: an unmatched `*` in a *finished* paragraph is a hard error even in the final doc → escape it. |
| `#table(columns: 2, [a], [b` | 2× unclosed delimiter | Nested frame stack; close `]` then `)`. |
| `#let x = ` / `#show heading: it =>` / `#let f(x) = x +` | `expected expression` | Can't just close — must **drop** the incomplete statement. |
| `#tabl` | `unknown variable: tabl` | Partial identifier after `#` — drop it. |
| `text #` / `cost # 5` | `expected expression` | Dangling/bare `#` → drop or escape. |
| `$x^` / `$ frac(a, $` | unclosed + expected expression | In math, drop trailing operator; close function parens; but **plain parens in math are lenient** (`$ [0, 1) $` is fine — don't "fix" them). |
| ```` ```py⏎print(1) ```` / `` `code `` | `unclosed raw text` | Close with the *same* backtick run. |
| `/* unclosed` | compiles (comment swallows rest) | Block comments nest; no repair needed, but scanner must track depth. |
| `Hi <lab` | `unclosed label` | Drop partial label. |
| `See @fig1` (label later in stream) | `label <fig1> does not exist` | **Forward references are normal while streaming** → semantic fixer. |
| `email me@x.com` | `label <x.com> does not exist` | Markdown-ism / email → escape `@` (lint, also in final). |
| `# Heading` | `expected expression` | Markdown heading → convert to `= Heading` (lint). |
| `this is **bold**` | compiles silently as empty strong | Silent misrender → lint convert to `*bold*`. |
| `costs $5 and $10` | compiles silently as math | Silent misrender → currency lint (`\$`). |
| `text ] more` | `unexpected closing bracket` | Stray closers need escaping too. |
| `#while n >= 0 { n += 1 }` | `loop seems to be infinite` (fast) | Typst has an iteration limit… |
| `#let f(x) = f(x + 1)` | `maximum function call depth exceeded` | …and a recursion limit… |
| `range(100000000).map(x => x)` | **ran > 25 s** (killed) | …but no time/memory limit → **watchdog + worker termination is mandatory**. |
| `/* a /* b */ c */` | compiles | Nested block comments confirmed. |

HTML export (0.15, `--features html`) findings:
- Produces semantic HTML + **MathML** (`<math display="block">…`), `<figure>/<figcaption>`, resolved `<a href="#t">Table 1</a>`, `<nav role="doc-toc">`, endnote footnotes.
- **Drops content** of unsupported layout elements with a warning (`grid`, `rect`, `align`, `place`, `line`, `v`, `pagebreak`, `page` set rules). The *text inside* `#grid[...]` disappears.
- **Much cheaper to compile**: a 6.4 KB / 40-section document with math and tables takes ~150 ms for a cold native CLI PDF compile vs ~32 ms for HTML (no layout).
- `html.frame(it)` renders any content as inline SVG; show rules gated on `context target() == "html"` work (verified). → we ship an **`html-compat` prelude** that maps unsupported elements to `html.elem` (where semantic) or `html.frame` (where visual). This is the bridge that makes the HTML target usable.

Wasm measurements (desk research: typst.ts `typst-ts-web-compiler@0.8.0-rc3`, Typst 0.15.0-rc.1, Node 25 on an M1 Pro; real-browser numbers in [spikes/phase0/RESULTS.md](spikes/phase0/RESULTS.md) and §6.1):
- **Streaming a ~6-page document (2.1 k chars), compiling a prefix every 25 chars: 70% of raw prefixes fail with syntax errors.** Without healing, the preview would be broken most of the time. This is the strongest argument for §5.
- Failing compiles fail fast (median 0.2 ms); successful warm compiles: **median 10 ms, p90 15 ms, max 69 ms**. First compile ≈ 145 ms (font parsing + layout). Wasm compile + instantiate ≈ 40 ms once downloaded.
- Compilation is all-or-nothing: `typst-eval` refuses to evaluate if *any* syntax error exists, and runtime errors (unknown variable, missing label) abort too. There is no partial document to show.
- The parser itself is lossless: every unclosed construct becomes an `Error` node and parsing continues (max nesting depth 256). That makes `typst-syntax` a perfect **oracle** for our healer's tests.
- `while` loops are capped at 10,000 iterations; recursion is depth-limited; but allocation/layout bombs are not limited at all.
- An unclosed `/* …` is **not** an error: it silently swallows the rest of the file. The healer must handle this deliberately (§5.3, §5.4).
- No existing streaming/partial Typst renderer exists (npm, GitHub, web) — typstream would be the first.

---

## 4. Architecture

```
 LLM token stream
       │  (string chunks; may split UTF-16 surrogates, may wrap in ```typst fences)
       ▼
┌────────────────────────────── main thread ──────────────────────────────┐
│ StreamBuffer ── Layer 0: normalize (fences, BOM, CRLF, surrogates)     │
│      │                                                                  │
│      ▼                                                                  │
│ @typstream/heal                                                         │
│   IncrementalScanner (mode stack, checkpoints)  ── O(Δ) per append     │
│   Layer 1: lint fixes on *settled* text (markdown-isms, stray delims)   │
│   Layer 2: tail repair (trim incomplete atom, close open frames)        │
│      │ healed source + SourceMap(healed→original) + stable boundary     │
│      ▼                                                                  │
│ CompileScheduler (latest-wins, adaptive throttle, cancellation)         │
└──────┼──────────────────────────────────────────────────────────────────┘
       │ postMessage {rev, files delta, target}
┌──────▼──────────────────────── Web Worker ──────────────────────────────┐
│ Engine (adapter: @typstream/engine-wasm — our Typst build — by default)│
│   VirtualFS: main.typ, preamble, @typstream/edu, html-compat, images   │
│   Fonts: base set + lazy script-specific fonts                         │
│   Packages: allowlisted, pre-bundled or fetched from mirror            │
│   compile(target) → diagnostics + artifact (HTML string | vector doc)  │
│   Layer 3: semantic fixers (diagnostic → source patch → recompile ≤2)  │
│   Layer 4: fallback (last-good, block isolation)                       │
└──────┼──────────────────────────────────────────────────────────────────┘
       │ {rev, artifact | delta, diagnostics, status}
┌──────▼──────────────── main thread: renderer ───────────────────────────┐
│ html target: sanitize → hast → keyed block diff → React; word fade-in   │
│ paged target: per-page vector diff → SVG/canvas; unchanged pages kept   │
│ Overlays: islands, caret, "updating" indicator, diagnostics panel      │
└─────────────────────────────────────────────────────────────────────────┘
       Watchdog (main thread): compile > budget → terminate + respawn worker
```

### 4.1 Packages (pnpm + turbo monorepo, mirrors streamdown's layout)

Packages are layered; a package may only depend on layers below it (enforced by a dependency-cruiser rule in CI). **v1** marks what we build now; the rest are reserved names whose contracts v1 must already satisfy (§10).

| Layer | Package | Contents | Deps | When |
|---|---|---|---|---|
| 0 · contracts | `@typstream/core` | Types & tiny utilities only: `TextEdit`, `Span`/`Range`, `SourceMap`, `Diagnostic`, `Revision`, `TypstreamPlugin` contract, worker protocol message types, error classes. | none | v1 |
| 1 · language | `@typstream/heal` | Normalizer, incremental scanner, lint rules, tail/region repair. Pure TS. | core | v1 |
| 1 · language | `@typstream/syntax` | Small custom wasm over `typst-syntax` returning a structured (JSON/flat-array) CST, incremental reparse, node↔span queries. Test oracle in v1, editor foundation later. (`@typstyle/typstyle-wasm-bundler`, 247 KB gzip, is the real parser but only returns a text dump — fine as a stopgap oracle.) | core | v1 (oracle), public later |
| 2 · runtime | `@typstream/engine` | Worker "language service": compile, diagnostics, scheduler, watchdog, VFS, fonts, packages, semantic fixers, fallback ladder, `EngineAdapter` + adapters (engine-wasm default; typst.ts, typst-wasm, server optional). Later: completion, hover, jump, format. | core, heal | v1 |
| 2 · runtime | `@typstream/engine-wasm` | Our wasm build of the Typst crates (Rust, wasm-bindgen): in-memory World, HTML/SVG (+ lazy PDF module), changed-page detection, `comemo::evict`, structured diagnostics. Pinned Typst version. | (Rust) | v1 |
| 2 · runtime | `@typstream/node` | Server-side validate / render (PDF, HTML, SVG), LLM fix-loop helper, diagnostics formatter. | core, heal, engine | v1 |
| 3 · content | `@typstream/edu` | Typst package for educational primitives + templates + prompt kit, *packaged as a `TypstreamPlugin`*. | core | v1 |
| 3 · content | `@typstream/html-compat` | Typst prelude mapping layout elements for the HTML target. | core | v1 |
| 4 · bindings | `@typstream/dom` | Framework-free renderers (`html`, `svg-pages`), sanitizer, `mountTypstream(el, opts)`. | core, engine | v1 |
| 4 · bindings | `@typstream/react` | `<Typstream>`, `useTypstream()`, islands, caret, diagnostics UI — thin layer over `dom`. | dom, react (peer) | v1 |
| 4 · bindings | `typstream` | Convenience meta-package (`import { Typstream } from "typstream"`), like `streamdown`. | react, engine, heal | v1 |
| 5 · integrations | `@typstream/ai` | Glue for AI SDKs (`useChat` parts → `stream`), prompt kit loader, structured "edit region" streaming, server fix-loop route helpers. | core, heal | v1.x |
| 5 · editors | `@typstream/codemirror` | Source-mode editor: highlighting (build on / contribute to `codemirror-lang-typst`, an existing Lezer grammar for Typst 0.15), diagnostics, completion/hover via engine. | syntax, engine | future |
| 5 · editors | `@typstream/editor-core` / `@typstream/editor-react` | Plate-style visual editor: structured view over the CST, edits as minimal text patches. | syntax, engine, dom | future |
| — | `apps/website` | Landing page + docs + embedded playground (§10.5). | | v1 (MVP docs) |
| — | `apps/playground` | Dev playground: replay streams, inspect healed source & diagnostics, record corpus cases. | | v1 |
| — | `examples/*` | `nextjs-ai-sdk`, `vite-react`, `vanilla`, `node-validate` — smoke-tested in CI. | | v1 |
| — | `corpus/` | Test corpus (§11.2). | | v1 |

---

## 5. Error correction & auto-closing (the core)

The guarantee we want: **for every prefix P of a stream, render(heal(P)) is either a clean compile or the last-good render — never an error screen.** And for the complete document D: `heal(D) == D` whenever D is valid (healing never changes a correct document).

### 5.1 Layer 0 — Normalization (StreamBuffer)

Applied to the raw stream before anything else; all transforms are tracked in the source map.

- **Fence unwrapping**: LLMs often emit ```` ```typst … ``` ```` or prefix chatter ("Here is your worksheet:"). Configurable: `unwrap: "auto" | "never"`. Auto = if the stream begins (after whitespace) with a ```` ```typ(st)? ```` fence, strip it and its closer.
- **Surrogate safety**: a chunk can end on a lone high surrogate → hold it back until the next chunk (never feed it to the compiler).
- BOM removal, `\r\n` → `\n` (Typst handles both, but our offsets must be stable), NUL/control-char stripping.
- **Edit detection** when the caller passes whole strings (`source` prop): if the new text extends the previous one, it's an append; otherwise diff the common prefix/suffix into a single `TextEdit` and apply it (§5.2) instead of resetting — callers that already have edits (editors, CRDTs) pass them directly.

### 5.2 The incremental mode-aware scanner

> **As built (Phase 1):** instead of a heuristic frame stack, `@typstream/heal` contains a **faithful TypeScript port of typst-syntax 0.15.1's lexer and parser, used as a recognizer**: same grammar, lookahead, newline modes and mode switches, no tree. When a construct meets the *real* end of input, it records a requirement: either `close` (append `]`, `)`, `*`, `$`, `"`, backticks, `:`) or `cut` (drop an incomplete construct back to its start, e.g. `#let x =`, `$x^`). *Soft* cuts handle words that may still grow (`#tabl`, `$alph`). Typst's real parser, compiled to wasm (`tools/typst-syntax-oracle`), is the oracle in every test. The sketch below was the original design; the port supersedes it.

A hand-written lexer (no regex backtracking — see streamdown's comment on exponential list-marker regexes) that maintains a **frame stack**:

```ts
type Frame =
  | { kind: "markup" }                                  // root or inside [ ... ]
  | { kind: "content"; open: number }                   // [ ... ]
  | { kind: "code-block"; open: number }                // { ... }
  | { kind: "parens"; open: number; role: "args" | "group" | "array" | "dict" | "params" }
  | { kind: "math"; open: number; display: boolean }    // $ ... $
  | { kind: "math-call"; open: number }                 // frac( ... ) inside math — strict
  | { kind: "string"; open: number }                    // "..." (escapes, \u{...})
  | { kind: "raw"; open: number; ticks: number; block: boolean; lang?: string }
  | { kind: "block-comment"; open: number; depth: number }
  | { kind: "strong"; open: number } | { kind: "emph"; open: number }
  | { kind: "embedded-expr"; open: number; stage: ExprStage } // after `#` in markup/math
  | { kind: "statement"; open: number; keyword: "let" | "set" | "show" | "import" | "include" | "if" | "for" | "while" | "return" | ... };
```

Typst rules the scanner must encode (each gets a test file):
- Markup: `*` strong / `_` emph (word-boundary rules, paragraph-scoped), `` ` `` raw (1 tick inline; ≥3 ticks block with lang; 2 = empty raw), `$` math (display iff whitespace after open & before close), `#` → embedded expression, `[`/`]` content (stray `]` is an error), `<label>`, `@ref` (with `[supplement]`), `\` escapes incl. `\u{…}`, `//` and nested `/* */` comments (**but not** inside URLs: `https://a//b` — Typst autolinks), `=` headings at line start, `-`/`+`/`/ Term:` lists, `~`, `---`, smart quotes.
- Code: `{}` `[]` `()` with role detection (needed to know what a trailing `name:` means), strings, keywords, closures `=>`, statement termination by newline or `;` (unless inside brackets).
- **Embedded-expression end in markup**: `#ident` then any chain of `.field`, `(args)`, `[content]` with *no whitespace*; ends at first other char. Keywords (`#let`, `#set`, `#show`, `#if`, `#for`, `#import`) parse to end of statement/line. This determines whether the tail is "inside code".
- Math: `#` embeds code, `"..."` text, `\` escapes, function calls `f(…)` strict, bare parens/brackets lenient, `&` and `\` line breaks.

**Incrementality — edits, not just appends.** The scanner records **checkpoints**: offsets where the stack is `[markup]` at the start of a line following a blank line (no open frames, not in a statement), each storing the scanner state. The public entry point is `applyEdit({ from, to, insert })` from `@typstream/core`; an append is just `from = to = length`.
- On any edit, invalidate checkpoints after the last checkpoint ≤ `from`, rescan from there, and **stop early** as soon as the new state at a checkpoint position equals the old state at the (shifted) same position — the rest of the document is unaffected (the same resynchronization trick CodeMirror/Lezer and tree-sitter use).
- For appends this degenerates to "resume from the last checkpoint": O(chunk + distance to last checkpoint) per token. Constructs that are look-ahead-sensitive are flagged and tested.
- v1 only *needs* appends (and full resets for regenerate), but the edit path is implemented and covered by the "random edit ≡ full rescan" property test (§11.1) so the editor never needs a new scanner.

> **As built (resync, #5):** checkpoints are root-markup line starts storing `{ offset, nesting }` (open text brackets). After an edit, `updateState` resumes at the last checkpoint whose *following* checkpoint is still at or before `edit.from`, not at the last one before it. Whether a position is a checkpoint depends on the token there, and the lexer may read to the end of its line to find where that token ends (`#\n*` + `/*` turns the `*` into a `*/` that the `#` consumes, so 2 stops being a checkpoint). Recognition stops at the first new checkpoint whose shifted offset and nesting match an old one. That checkpoint must be the *second* one past the edit, because the lexer looks back from a token (`column()` to the line start, keywords two characters). The old checkpoints, errors, lint events, mode spans, requirements and `lastTokenStart` after that point are reused, shifted by the edit's length change. Cached lint findings past it are reused too, except when `settled` handlers are registered (they may read anything). Edits that change the rest of the document (an unclosed `/*`, a deleted `"`, a new `[`) never match and re-parse to the end. `resync.test.ts` checks the spliced state against a fresh recognition and asserts bounded re-parsing; `scripts/perf.mjs` budgets a one-character edit in the middle of 100 KB.

Checkpoints double as **stable boundaries** for the renderer and for fallback (§5.6).

**Streaming regions, not only streaming tails.** Healing is defined over a *streaming range* `[start, end)` rather than "the end of the document": the text before `start` is settled, the text after `end` is settled, and the region in between is being written by the model. Whole-document generation is the case `end = length`. The general case is **AI editing** ("rewrite question 3", "add an answer key below") streaming *into the middle* of an existing document: the scanner state at `start` is known from checkpoints, the region is healed as if it were a tail (trim the partial atom, close the frames opened *inside* the region), and the suffix is reattached unchanged. This one generalization covers chat generation today and editor AI commands later.

Outputs per scan: frame stack, `regions` (Uint8Array like remend's) for O(1) "what mode is offset i in", list of open-frame offsets, list of *settled* lint findings, checkpoint list, `lastStableOffset`.

### 5.3 Layer 1 — Lint fixes (settled text, also apply in final mode)

Rules run only on text before `lastStableOffset` *or* on the complete document; each rule is pure `(scan, text) → Patch[]`, individually toggleable, with a severity (`fix` | `warn`). They exist because these errors are permanent, not streaming artifacts.

| Rule | Detects | Fix |
|---|---|---|
| `markdown-heading` | `^#{1,6} ` in markup at line start (not a valid `#expr`) | `= `×n |
| `markdown-bold` | `**text**` in markup | `*text*` |
| `markdown-link` | `[text](url)` in markup | `#link("url")[text]` |
| `markdown-inline-code` | Leave alone (valid raw in Typst) | — |
| `email-at` | `\w@\w+\.\w` in markup (not a ref to an existing label) | `\@` |
| `currency-dollar` | `$` followed by digit and paired math containing prose words | `\$` (heuristic, warn by default) |
| `unmatched-strong-emph` | Unclosed `*`/`_` in a *finished* paragraph | escape `\*` / `\_` |
| `stray-closer` | `]` / `)` / `}` with no open frame in markup | escape |
| `bare-hash` | `#` followed by whitespace/digit in markup | `\#` |
| `unclosed-block-comment` | `/*` never closed in the complete document | warn (content after it is invisible) |
| `unknown-font` (advisory) | `#set text(font: "X")` with font not in registry | warn; engine falls back |

### 5.4 Layer 2 — Tail repair (auto-closing)

Runs on the **tail only** (text after `lastStableOffset`). Two phases:

**Phase A — trim the incomplete atom at the very end.** Determined by the top frame and the last token:

| Situation at end of input | Action |
|---|---|
| Partial identifier after `#` (`#tabl`, `#ta`) or bare `#` | drop from `#` |
| Partial keyword statement: `#let x =`, `#let f(x) = x +`, `#set text(size:`, `#show heading: it =>`, `#import "@preview/` | drop the **whole statement** (global rules must never apply half-written — they'd restyle the entire doc and flicker) |
| Dangling binary operator / `.` / `=>` / `:` key without value in code | drop back to last complete element (`(a: 1, b:` → `(a: 1`) |
| Trailing operator in math (`^ _ / + - = &`, `\` linebreak) | drop operator |
| Partial escape `\`, `\u{1F6` | drop |
| Partial label `<lab`, bare `@`, `@fig:` | drop (or keep `@fig:` with config `refs: "drop" \| "placeholder"`) |
| Partial raw run at line start (` `` ` while a ```` ``` ```` block is open) | drop the partial closer |
| Partial line-start marker (`=` alone, `- ` empty item, `/ Term:` with no body) | keep (valid) — but optionally hide empty list items |
| Mid-word | keep (it's just text) |

**Phase B — close open frames, innermost first.**

| Frame | Closer |
|---|---|
| `strong` / `emph` | `*` / `_` (if the frame opened in the current paragraph) |
| `string` | `"` (after dropping a partial escape) |
| `raw` inline | same tick run; `raw` block → `\n` + same tick run (≥ opener) |
| `math` | `$` (or ` $` for display: keep display-ness) |
| `math-call` / `parens` | `)` |
| `content` | `]` |
| `code-block` | `}` |
| `block-comment` | `*/` × depth. Not needed for compilation (an unclosed comment compiles), but closing it keeps the source map and stable boundaries sane while streaming. In **final** mode an unclosed block comment is reported by the `unclosed-block-comment` lint (it silently hides everything after it). |
| `embedded-expr` | nothing (closing its children completes it) |
| `statement` (`#if cond [` …) | close children; `#if cond` with no body yet → drop statement |

Then **empty-construct pruning** (configurable): e.g. `#figure(` with nothing inside → drop rather than produce an empty figure; `#table(columns: 3, [a]` → fine (Typst pads missing cells).

**Additions found while building it** (each one came from a failing property test):
- An open *text* bracket (`[` in markup) needs a `]` only if an enclosing content block will append its own `]`. Otherwise (in a heading, or at root) closing it is wrong.
- **Stable offset** = the last root checkpoint whose first character is followed by at least one more character. Earlier definitions moved backwards when tokens merged (`https:` → a link) or a line-start `/` became `//`. This one is monotone under appends and independent of how the stream is chunked.
- **Streaming regions** pick a separator between the healed region and the untouched suffix: `""`, then a zero-width space, a space, or a newline. Without it, `p` + `*bold*` would make the suffix's `*` word-internal.
- Repair is verified: each candidate is re-recognized before it's accepted. After a few failed rounds the whole outermost open construct is cut, so pathological input stays linear (20,000 nested `#box[` in 73 ms).

**Invariants** (all property-tested, §11.1):
1. **Validity**: `typst-syntax` parse of `heal(P)` has zero syntax errors for every prefix P of a syntactically valid document D.
2. **Preservation**: all of P except a bounded tail (one atom / one incomplete statement) is a subsequence of `heal(P)`.
3. **Idempotence**: `heal(heal(P)) == heal(P)`.
4. **Identity on valid docs**: `heal(D) == D` when D compiles cleanly (Layer 1 off) — no "fixing" of correct documents.
5. **Monotonic stability**: `lastStableOffset` never decreases during an append-only stream.
6. **Linear time**: heal on a 1 MB input under N ms; no input causes super-linear behavior (fuzzed with pathological inputs: 100k nested `[`, 10k backtick runs).

**Source map.** Every patch records `{healedRange, originalRange, reason}` so diagnostics, caret position and "click to source" map back to the user's/LLM's text.

**API (mirrors remend):**
```ts
heal(source: string, options?: HealOptions): HealResult        // stateless, whole-tail
createHealer(options?: HealOptions): {                          // incremental
  push(chunk: string): HealResult;                              // append (chat streaming)
  applyEdit(edit: TextEdit): HealResult;                        // arbitrary edit (editor, regenerate)
  setStreamingRange(range: Range | null): HealResult;           // AI writing into the middle
  reset(text?: string): void;
  state(): ScanState;
}

interface HealResult {
  source: string;               // compilable (best effort)
  stableOffset: number;         // in healed coordinates
  patches: Patch[];             // for source map / debugging
  openFrames: Frame[];          // e.g. UI can show "writing table…"
  findings: LintFinding[];
}
interface HealOptions {
  lint?: Partial<Record<LintRuleId, boolean | "warn">>;
  tail?: { dropIncompleteStatements?: boolean; refs?: "drop" | "placeholder"; pruneEmpty?: boolean };
  unwrapFences?: "auto" | "never";
  handlers?: HealHandler[];     // custom, see §8.1
}
```

### 5.5 Layer 3 — Semantic fixers (diagnostic-driven, in the worker)

Some errors only appear after evaluation. The worker compiles the healed source; if there are **errors**, it maps each diagnostic to registered fixers, applies patches, and recompiles — **at most 2 extra rounds**, each budgeted. Fixers are pure `(diagnostic, source, ctx) → Patch[] | null`, ordered by priority.

| Diagnostic (pattern) | Fixer | Streaming | Final |
|---|---|---|---|
| `label <x> does not exist` (from `@x`) | Rewrite `@x` → `#typstream.pending-ref("x")` (styled grey placeholder text) | ✓ | ✓ (+ report) |
| `unknown variable: foo` at tail | Drop (scanner miss) | ✓ | report |
| `file not found` for `image("x.png")` | Replace with `#typstream.image-placeholder(alt)` box | ✓ | ✓ (+ report) |
| `unknown font family` | warning only; ensure fallback | ✓ | ✓ |
| `package not found` / not allowlisted | Async: fetch if allowlisted, else replace import with stub + report | ✓ | ✓ |
| `expected X, found Y` in an *argument value* still in the tail | Drop that argument | ✓ | ✗ |
| `loop seems to be infinite` / `maximum function call depth` | Isolate block (§5.6) | ✓ | ✓ |
| `unclosed delimiter` (scanner bug safety net) | Re-run heal in strict mode; log telemetry | ✓ | — |

Fixers that need IO (fonts, packages) are **async**: the engine renders with a placeholder now and schedules a recompile when the resource arrives.

**Measured (#13).** The table above was a hypothesis. `tools/compile-oracle` healed and compiled every stream prefix of the 39 corpus documents that compile complete (16,618 prefixes) and of 150 generated documents (6,315). **88.0% of corpus prefixes compile** (87.9% paged; 87.7% when cutting at every code point); 96.3% of generated ones. 36 of 39 documents fail somewhere. Error classes, as a share of all corpus prefixes:

| Class | Share | Where | Cause |
|---|---:|---|---|
| missing argument | 4.5% | tail, at the cut | A call closed before its required arguments arrived: `#text(` → `text()`, `#align(center` (body comes after `)`), user functions. Needs signatures, so only the compiler knows. |
| type mismatch | 3.3% | tail, 98% at the cut | A value still being typed: `#v(1` (integer, not length), `0.`, `stroke: (` (array), `..xs.zip(` |
| citation before bibliography | 2.9% | settled | `@key` cites a bibliography entry; `#bibliography(..)` is the last line. One document: **70% of its stream (21 s) never compiles.** |
| invalid value | 0.6% | tail, at the cut | A string or array still being typed: `rgb("#e`, `link("")`, `lang: ""`, `(0cm, 2.5cm), (1` |
| unknown variable | 0.3% | tail | Closure parameters before `=>` arrives (`.map(((l, t)` is an array of unknowns) |
| invalid operation | 0.3% | 69% settled | A settled function called with a half-typed argument fails in its body (`#mcq(q, ([Arg`); the call site is in the tail, in the diagnostic's trace |
| partial reference | 0.1% | tail, at the cut | `@fig-` of `@fig-cell` |
| file not found | 0.02% | tail, at the cut | A path still being typed: `bibliography("assets/clim` |
| syntax | 0.01% | tail | Only heal's two known bugs |

Forward references (`@x` before `<x>`) never occurred: the corpus defines labels before using them. No `unknown font`, `package`, infinite-loop or call-depth errors occurred in prefixes. HTML and paged output fail on the same prefixes, except that 64-deep nesting exceeds Typst's maximum HTML depth even when complete.

What handles each class:
- **Heal, syntactically** (no compile round): drop a code value still being typed at the cut inside an argument list, array or dictionary (a number literal, a string heal had to close, an open group), generalizing `(a: 1, b:` → `(a: 1`; drop a reference that touches the end of the input; drop an incomplete `#let` like an incomplete set/show rule (generated documents' `#let (a, b) = (1,`). Content blocks keep streaming. This covers type mismatch, invalid value, file not found and partial references: about 4% of prefixes.
- **Layer 3, two generic fixers** (#20): *tail cut*: an error in the unsettled tail, or whose trace has a call site there, cuts the healed source at that point and re-heals (missing argument, unknown variable, invalid operation, and anything heal leaves); *pending reference*: `label <x> does not exist` rewrites the `@x` to a placeholder while streaming and is reported in final mode. A simulation of the two (`simulateFixers` in the oracle) fixes 80% of failing prefixes in one round and 95% in two: **99.4% of corpus prefixes compile with the 2-round limit**, 99.95% with 3. The longest remaining stale run is 0.6 s.
- **Last-good render** (§5.6 level 1) for the rest. The stable-prefix compile (level 2) would rescue only 75% of failures and drops the whole unsettled tail (often a whole table), so tail cut comes first.
- The other rows of the table (`file not found` for images, fonts, packages, loops) didn't occur here; they stay as hypotheses until a corpus has them (images, #25 packages).

### 5.6 Layer 4 — Fallback ladder

If errors remain after Layer 3:

1. **Last-good render** (streaming): keep showing the previous successful artifact; show a subtle "updating…" state. The stream keeps going; the next token usually fixes it. Telemetry counts consecutive failures.
2. **Stable-prefix compile**: compile `heal(source[0..lastStableOffset])` (always cached from earlier) + render the remainder as plain styled text below (`raw`-ish preview). Used when last-good is too stale (> N tokens or > 1.5 s).
3. **Block isolation** (final mode, or persistent streaming errors): split at top-level checkpoints, bisect to find failing blocks (O(log n) compiles, since state flows forward we test prefixes), replace each failing block with `#typstream.error-block(raw: "...", message: "...")` and compile the rest. Teachers see the full document with an inline, friendly "this part couldn't be displayed" box — never a blank screen.
4. **Raw source view** as last resort (and toggle for power users).

### 5.7 Final mode & the LLM fix loop

When the stream ends (`isStreaming=false`), the pipeline switches to **strict**: no tail repair (a truncated stream is reported, not hidden), lint fixes per config, semantic fixers still on, block isolation for the rest. Then:
- `onDiagnostics(diags)` fires with source-mapped, deduplicated, human-readable diagnostics.
- `formatDiagnosticsForLLM(source, diags)` (in `@typstream/node` and engine) produces a compact repair prompt (line excerpts + messages + hints) so the app can run an **automatic AI fix pass** (server-side preferred: `@typstream/node.validate()` before persisting a document).
- The edu prompt kit (§8.3) is the first line of defense; telemetry from fixers feeds the prompt kit's "don'ts".

---

## 6. Compile engine

### 6.1 Engine adapter

```ts
interface EngineAdapter {
  init(opts: { wasmUrl?: string; fonts: FontSource[]; packages: PackageResolver }): Promise<void>;
  setFiles(delta: Record<string, string | Uint8Array | null>): void;   // incremental VFS update
  compile(req: { entry: string; target: "html" | "paged"; inputs?: Record<string, string> }):
    Promise<{ diagnostics: Diagnostic[]; artifact?: HtmlArtifact | PagedArtifact; timings: Timings }>;
  exportPdf(): Promise<Uint8Array>;
  dispose(): void;
}
```
**State of the options (Oct 2026)** — none covers everything yet, which is exactly why the adapter boundary matters:

| Option | Typst | Paged (vector/SVG, incremental) | HTML target in wasm | Notes |
|---|---|---|---|---|
| **typst.ts** web compiler + renderer (`@myriaddreamin/*`) | 0.14.2 (`latest` 0.7.0), 0.15.0-rc.1 (`rc` 0.8.0-rc3); main tracks 0.15.1, unreleased | ✓ `IncrementalServer` → delta artifacts merged by the renderer (`manipulateData`) | ✗ — open PR #894 adds `CompileFormatEnum.html` | Mature renderer. **Memory leak: comemo cache never evicted in the web build (issue/PR #895, ~100 compiles → crash)**. Packages/lazy fonts use sync XHR → dedicated worker only. Node compiler already has `.html()`/`.hast()`. |
| **typst-wasm** (npm 1.0.0, MIT) | 0.15.0 | SVG/PNG/PDF (full pages each compile) | ✓ | 6.22 MB brotli. Worker backend needs COOP/COEP; JSPI backend works without isolation in Chromium 156 / Firefox 157 / WebKit 27.2 but runs on the calling thread (host it in our worker). ~1.5× slower HTML streaming than the custom build; no eviction API. |
| **Custom build** (`typst` + `typst-html` + `typst-svg` via wasm-bindgen; spike in `spikes/phase0/custom-engine`, ~350 lines of Rust) | 0.15.1, we pin | SVG for changed pages only (`compile_svg_changed`, measured) | ✓ | **5.86 MB brotli** (HTML+SVG), +0.34 MB with PDF. Fastest HTML streaming (20 pages: p50 17–22 ms, warm 2 ms). With `comemo::evict(2)` after each compile, **memory stays flat at ~21 MB** over 200 compiles (typst.ts: 280 MB). No COOP/COEP, no JSPI. Costs a small Rust crate + CI wasm build. |
| **Server adapter** (`@typstream/node`, native typst or typst.ts NAPI) | any | ✓ | ✓ | No download for the client; latency + cost on our side. |

**Decision (Phase 0, measured in Chromium, Firefox and WebKit — see [spikes/phase0/RESULTS.md](spikes/phase0/RESULTS.md))**:
- **Default adapter: our own build** (`@typstream/engine-wasm`, Rust crate in the monorepo), HTML target first.
- **Paged target: our build with changed-page export** (`compile_svg_changed`). It hashes each page frame and exports SVG only for pages that changed: median 1 page per streamed step. At 20 pages, main-thread render is 5–9 ms p50 (typst.ts 3–8 ms; sending all pages 58–146 ms). First paint of a full document is faster than typst.ts (45–88 vs 80–146 ms). **typst.ts is dropped**, so there's one engine and one wasm download. Remaining worst case: occasional multi-page reflows (40–70 ms when 7 pages change). Handle it with visible-pages-first DOM updates and offscreen pages in idle time (§6.5).
- typst.ts and typst-wasm remain possible adapters behind the conformance suite, but we don't ship them.
- A **server adapter** is a first-class option, not an afterthought, given the download size (§6.4).

**As built** ([#8](https://github.com/ikramhasan/typstream/issues/8), `packages/engine-wasm`): the Phase 0 crate, cleaned up. `Engine` has `add_font`, `set_source` / `set_file` / `remove_file` (virtual absolute paths), `set_inputs({ key: "value" })`, `compile_html()`, `compile_svg_changed()` + `reset_pages()`, and static `features()` / `memory_bytes()`. Differences from the spike and the sketch above:
- There is no full-document `compile_svg()`: `reset_pages()` then `compile_svg_changed()` sends every page.
- `comemo::evict(2)` runs inside every compile; `evict` is not exported.
- Diagnostics already have `@typstream/core`'s `Diagnostic` shape (#7), with `/main.typ` as the document: `{ severity, span, message, hints, trace, file?, source: "typst" }`. All spans are `{ from, to }` in **UTF-16**. For a problem in another file (a source, or a UTF-8 data file such as JSON), `span` is the nearest call site in `/main.typ` from the trace and `file: { path, span }` is the original location. Trace items have a span only where they are in `/main.typ`. Hint spans are dropped. The "html export is under active development" warning is filtered. engine-wasm can't import core (its layer row has no deps), so the shape is mirrored, not shared; the worker (#10) only remaps offsets (preamble, fixers) with `mapDiagnostic`.
- `datetime.today()` is the real local date (the spike fixed it to 2026-01-01), as in the CLI.
- PDF export is a cargo feature (`FEATURES=pdf ./build.sh`), not in the default build; how PDF ships is [#18](https://github.com/ikramhasan/typstream/issues/18).
- Tests compare HTML and every SVG page byte for byte with native `typst compile` 0.15.1 using the same fonts (Typst's bundled set, read from the `typst-assets` crate).
- CI: an `Engine (wasm)` job builds it (Rust, wasm-bindgen, binaryen, native typst) and runs its types, tests, size, API report and package lint. The other jobs leave it out with `--filter=!@typstream/engine-wasm`.

typst.ts compiler API notes that shape the adapter: `addSource`/`mapShadow` for the VFS, `compile({ format: vector | pdf, diagnostics: "full", inputs })`, `query({ selector, field })` (used for islands), `setFonts(resolver)` shared across compiler instances. Diagnostics come back as `{ severity, range: "sl:sc-el:ec" (zero-based in practice), message }` with **hints concatenated into `message`** — the adapter normalizes this into `@typstream/core`'s `Diagnostic` (`{ severity, span, message, hints[], trace[] }`) so fixers never parse adapter-specific strings.

**The worker is a language service, not a compile function.** The main thread talks to it through a versioned, LSP-shaped protocol defined in `@typstream/core` (`{ id, method, params }` requests, `{ id, result | error }` responses, notifications for diagnostics/artifacts):

| Method | v1 | Later (editor) |
|---|---|---|
| `document/open`, `document/edit` (TextEdit[] + revision), `document/close` | ✓ | — |
| `compile` → artifact + diagnostics, `export/pdf`, `export/html` | ✓ | — |
| `resolve/span` (artifact position → source span), `resolve/location` (span → page/element) | basic (paged) | full |
| `completion`, `hover`, `definition`, `signatureHelp`, `format` (typstyle), `foldingRanges` | — | ✓ (typst-ide / tinymist-style services) |

Multiple documents per worker (chat history, editor tabs) share fonts, packages and the comemo cache. A protocol version number and capability negotiation (`initialize` → capabilities) let newer editors talk to older engines gracefully.

> **As built (#7):** the protocol is `packages/core/src/protocol.ts`; its TSDoc is the reference. Differences from the table above:
> - **Revisions.** Every document-scoped message (params, results, notifications) carries `{ uri, rev }`; revisions are client-chosen, increasing integers. Protocol-level messages (`initialize`, `shutdown`, `$/cancel`, `$/log`) carry none. `document/edit` with a non-increasing `rev` fails with `stale-revision`; compiling, exporting or resolving a revision that is no longer current fails with `content-modified`.
> - **Compile output is pushed, not returned.** For each compile the worker sends `document/diagnostics` (always), then `document/artifact` (on success), then the `compile` response, which carries only status, timings and `memoryBytes` (for recycling, §6.3). Server-initiated recompiles (a lazy font or package arrived) publish the same notifications for the same revision, and the later one replaces the earlier. A failed compile publishes no artifact; the client keeps last-good (§5.6).
> - **Changed pages are explicit.** A `PagedArtifact` lists only changed pages plus `pageCount`, and names the `base` revision it diffs against (`null` = all pages). A client whose pages aren't from `base` recompiles with `fullPages`. Clients opt in with the `pagedDiff` capability.
> - **Added:** `document/setFiles` (per-document images and data; a new revision), `shutdown`, `$/cancel` (drops a queued request; a running Typst compile can't be interrupted, so the watchdog stays the hard stop), `$/log`. `initialize` takes shared `fonts` and `packages`; `document/open` takes a `preamble` and `files`. `compile` takes `mode: "streaming" | "final"` and `anchors` (HTML, §10.2).
> - **`resolve/span` / `resolve/location`** are typed for paged output only, since HTML resolves blocks through renderer anchors. They are `@beta`, behind `resolveSpan` / `resolveLocation` capabilities. Editor services (completion, hover, …) will arrive as new capability flags, not a version bump.
> - **`Diagnostic`** is `{ severity: "error" | "warning" | "info", span: Range | null, message, hints[], trace[], file?, source?, code? }`. `span` is `null` when Typst gives no position in the document (e.g. a missing font). For errors inside the preamble or a package, `span` is the nearest call site in the document and `file` holds the original location. Helpers: `mapDiagnostic` (through heal's source map or an edit), `normalizeDiagnostics` (sort + dedupe), `formatDiagnostic`, `lineColumn`.

### 6.2 Scheduling

- **Latest-wins**: at most one compile in flight + one pending (the newest). Intermediate sources are discarded, never queued.
- **Adaptive throttle**: `interval = clamp(minInterval, 1.25 × EMA(compileMs), maxInterval)`; defaults `minInterval=33ms` (≈30 fps), `maxInterval=500ms`. Big docs naturally update less often; small docs feel live.
- **Boundary bias**: prefer compiling when the healer reports a new stable checkpoint (a finished paragraph/block) over mid-word ticks — fewer visual reflows, better cache hits.
- **Revision numbers** on every message; renderer ignores stale results.
- **Incremental compilation**: VFS updates only `main.typ`; preamble/packages/fonts stay resident; Typst's comemo memoization reuses layout of unchanged content.

### 6.3 Watchdog & resource limits

- Each compile has a wall-clock budget (default 3 s streaming, 10 s final). On timeout the main thread **terminates the worker** and spawns a fresh one (pre-warmed spare worker to make this ~instant), marks the offending revision, and falls back (§5.6) — block isolation runs in the fresh worker with per-block budgets.
- **Cache eviction**: the default adapter calls `comemo::evict(2)` after **every** compile. Eviction ages entries per evict call, and the cache is global per wasm instance. Measured: wasm memory flat at ~21 MB over 200 compiles, and compiles ~30% faster than without eviction (less memory pressure); without it, memory grew ~1.9 MB per compile.
- **Compiler recycling** (for adapters without eviction, i.e. typst.ts #895 — measured +1.3 MB per compile, 280 MB after 200 — and as a general safety net): the worker pool tracks wasm memory per worker; past a threshold (default 256 MB) it spins up a fresh worker in the background, warms it with the current document, then swaps — invisible to the user.
- Optional `maxMemoryMB` via a wasm memory cap where the adapter supports it.
- After 3 timeouts on the same document → stop live compiling, show "document too complex to preview live", compile once at the end.

### 6.4 Assets: wasm, fonts, packages

- **Wasm**: the compiler is **heavy**. Brotli-11 sizes: our build 5.86 MB (HTML+SVG; PDF +0.34 MB), typst-wasm 6.22 MB, typst.ts 7.74 MB + 0.37 MB renderer. The Typst core itself (eval, layout, shaping, bundled data) is ~5.8 MB; exporters are small. About 3 s at 20 Mbps (measured with network emulation). That is the biggest product risk for school devices on slow networks. Mitigations, in order:
  1. Load lazily, `WebAssembly.compileStreaming`, serve immutable with content hash from our own origin; persist in Cache Storage so the cost is paid once per release.
  2. **Preload hint** API (`preloadTypstream()`) so apps start the download when the user opens the "Generate" dialog — generation itself takes seconds, which hides most of the download.
  3. **Server adapter for the first document** while the wasm downloads in the background (hybrid mode: server artifacts until the local engine is warm, then switch).
  4. Ship PDF export as a lazily loaded second module or do it server-side (+0.36 MB otherwise).
  5. **Trim bundled data.** Typst has no feature gates, but patching two dependencies (hyphenation limited to the languages we support; a curated or empty syntax-highlight set) brought the engine to **4.29 MB brotli (−27%)**, verified in all three browsers at unchanged speed. `#[cfg]` patches to typst-library for bibliography, plugins and PDF-as-image are estimated to reach ~2.4–2.7 MB. That's a maintenance trade-off to decide once we know whether teachers need bibliographies and code highlighting.
- **Fonts**: the minimal default set (Libertinus Serif regular/bold/italic, New Computer Modern Math, DejaVu Sans Mono) is **≈ 2.6 MB raw / 1.45 MB brotli** (measured); the full typst-assets set is 9.9 MB. Ship the minimal set; register everything else **lazily**: put precomputed `FontInfo` in the `FontBook` at build time, and have the World's `font(index)` load bytes on first use (the worker prefetches them asynchronously when the healer detects a script; sync XHR in the worker is the fallback). `text.fallback` only sees fonts in the book, so lazy registration is required for fallback to work. **Script detection**: the healer reports Unicode scripts present (Bengali, Arabic, Devanagari, CJK, …); the engine fetches the matching Noto font *before* compiling text that needs it (or compiles with fallback and recompiles when loaded). Font registry is configurable; fonts cached in Cache Storage.
- **Packages**: allowlist (`@preview/cetz`, `@preview/fletcher`?, chemistry, …) pinned to versions; pre-bundled tarballs or fetched from our own mirror, untarred into the VFS **before** compiling (the World's `file()` is synchronous, so imports are resolved by a pre-pass that scans `#import "@preview/…"` and fetches asynchronously). No direct calls to third-party registries from users' browsers unless configured; tarballs persisted in Cache Storage. `@typstream/edu` and `html-compat` are mounted in the VFS as `@typstream/*` local packages.

### 6.5 Render targets

**`html` (default for chat/streaming)**
- Compile with HTML target; inject `html-compat` prelude (maps `grid/align/rect/place/columns/v/line/pagebreak` to `html.elem` or `html.frame`).
- Sanitize the HTML (allowlist tags/attrs; `href` protocol allowlist; SVG from `html.frame` sanitized), parse to hast, split into **top-level blocks** keyed by content hash → React reconciles only changed blocks (streamdown's memoized `Block` idea applied to *output*).
- Word fade-in via the animate timeline (diff text of the last block); caret appended to last text node.
- Styling via our CSS (themeable with CSS variables, dark mode free), MathML styled with a math font.
- Caveat: HTML export is experimental upstream → pin version, keep compat prelude under test (§11.4), and keep `paged` as the fidelity reference.

**`paged` (print preview, worksheets, exams)**
- Compile with `compile_svg_changed()`. The worker sends only pages whose frame hash changed (usually the last one or two). The renderer keeps one element per page, swaps changed pages, and updates visible pages first; offscreen pages are deferred to idle time; **page-level diff**: keep DOM for pages whose hash didn't change; lazy-render offscreen pages (IntersectionObserver, like streamdown's `useDeferredRender`).
- Layout modes: `fixed` (A4/Letter as authored) and `fit-width` (`#set page(width: <container>pt, height: auto)` via `sys.inputs`, recompiled on debounced resize) — a "continuous paper" view good for side panels.
- Text layer for selection/copy & search; links clickable (sanitized).
- New content highlight: a short fade on newly appeared glyph groups (opt-in; diff by element ids).

**Exports** (both): `exportPdf()`, `exportHtml()`, `exportSource()` — from the *same* final compiled source, so what the teacher previewed is what they print.

---

## 7. Public API & configuration (React)

```tsx
<Typstream
  source={text}                       // full text so far (streamdown-style), or:
  stream={asyncIterable}              // alternative: we consume chunks
  isStreaming={status === "streaming"}
  target="html"                       // "html" | "paged"
  layout="fit-width"                  // paged only: "fixed" | "fit-width"
  preamble={eduPreamble}              // Typst injected before user source (theme, edu functions)
  template="worksheet"                // named template from registry (sets page, fonts, header)
  inputs={{ showAnswers: "false" }}   // sys.inputs — e.g. answer-key toggle without regenerating
  heal={{ lint: { "currency-dollar": "warn" } }}
  engine={{ adapter: typstTsAdapter({ wasmUrl }), fonts, packages: allowlist, timeoutMs: 3000 }}
  schedule={{ minInterval: 33, maxInterval: 500 }}
  fallback={{ staleAfterMs: 1500, isolateBlocks: true }}
  animated caret="block"
  islands={{ "mcq": McqIsland }}      // render islands, §8.4
  theme="auto"                        // light | dark | auto — mapped to Typst colors via inputs
  onDiagnostics={(d) => …}
  onStatusChange={(s) => …}           // "idle" | "compiling" | "stale" | "error" | "done"
  onRendered={(info) => …}            // timings, pages, repair stats (telemetry hook)
  className=…
/>

const { status, diagnostics, exportPdf, healedSource, openFrames } = useTypstream(ref);
```

Configuration layering: library defaults → `TypstreamProvider` (app-wide: engine, fonts, packages, templates, theme) → per-instance props. Everything serializable (except adapters/components) so it can be stored per-organization or per-teacher in the product.

---

## 8. Extensibility

### 8.0 One plugin contract for the whole toolkit
Like Plate, a plugin is a single object with **optional facets**; each package reads only the facets it understands, so a plugin written today keeps working when the editor arrives, and the editor can add facets without breaking existing plugins.

```ts
// @typstream/core
interface TypstreamPlugin {
  key: string;                                  // unique, namespaced: "edu", "acme/chemistry"
  version?: string;
  dependencies?: string[];                      // other plugin keys
  // language (heal)
  heal?: { handlers?: HealHandler[]; lint?: LintRule[] };
  // runtime (engine, worker side — referenced by module URL, see 8.2)
  engine?: { fixerModules?: string[]; files?: Record<string, string | Uint8Array>;
             packages?: PackageSpec[]; fonts?: FontSource[]; preamble?: string };
  // content
  templates?: TemplateSpec[];
  prompt?: { catalogue?: FunctionDoc[]; rules?: string[]; examples?: PromptExample[] };
  // rendering
  islands?: Record<string, IslandSpec>;         // framework-neutral spec; bindings map to components
  sanitize?: { allowTags?: string[]; allowAttrs?: Record<string, string[]> };
  // editor (future — reserved, typed as unknown-extensible now)
  editor?: { nodes?: EditorNodeSpec[]; commands?: CommandSpec[]; toolbar?: ToolbarSpec[];
             shortcuts?: ShortcutSpec[]; slashItems?: SlashItemSpec[] };
}
```
> **As built (#7):** `packages/core/src/plugin.ts`. The `heal` facet is `{ handlers?: HealHandler[]; lint?: Record<ruleId, "fix" | "warn" | "off" | boolean> }`. Custom lint rules are `settled`-phase `HealHandler`s, so there is no separate `LintRule` type. `HealHandler` itself moved from heal into core, and heal re-exports it. `FontSource`, `PackageSpec`, `IslandSpec` and the `editor` facet are `@beta` and typed loosely until their issues (#11, #25, #28, #36) settle them. `definePlugin()` type-checks a plugin literal. The `engine` facet must stay structured-clonable (it is posted to the worker), and a type test enforces that.

`@typstream/edu` is itself just a plugin (Typst package files + templates + prompt catalogue + islands). Customers/third parties ship their own the same way (a school's branded templates, a chemistry pack, a music-notation pack).

### 8.1 Heal handlers (TS)
Like `RemendHandler`, but **scanner-aware** (no regex-on-raw-text guessing):
```ts
interface HealHandler {
  name: string;
  priority?: number;                       // built-ins 0–100
  phase: "lint" | "tail-trim" | "tail-close";
  run(ctx: { text: string; scan: ScanState; mode(i: number): Mode; frames: Frame[] }): Patch[];
}
```
Use cases: custom shorthand the LLM emits, product-specific syntax (`[[blank]]` → `#blank()`), stricter policies.

### 8.2 Diagnostic fixers (TS, worker)
```ts
interface DiagnosticFixer { name: string; match: RegExp | ((d: Diagnostic) => boolean);
  fix(d, source, ctx): Patch[] | null | Promise<Patch[] | null>; phases: ("streaming" | "final")[] }
```
Shipped in the worker bundle or registered by URL (workers can't receive functions) — fixers are loaded as ES modules inside the worker via `engine.fixerModules: string[]`.

### 8.3 Typst-level extension: preamble, templates, `@typstream/edu`
- **`@typstream/edu`** Typst package — the vocabulary we teach the LLM:
  `#question(points: 2)[…]`, `#mcq(options: (...), answer: 1)`, `#blank(width: 3cm, answer: […])`, `#answer[…]` (hidden unless `sys.inputs.showAnswers`), `#rubric(...)`, `#learning-objectives[...]`, `#worksheet-header(name: true, date: true, class: true)`, `#callout(kind: "tip"|"warning"|"definition"|"example")`, `#exercise-counter`, `#two-column[…]`, `#chem[...]`, `#graph-paper(...)`, `#number-line(...)`.
  Every function has an HTML-target branch (`context target()`), so both targets look right.
- **Templates**: named bundles (page setup, fonts, header/footer, numbering) — `worksheet`, `quiz`, `exam`, `lesson-plan`, `handout`, `rubric`. Registry is extensible by the app (org branding: school logo, colors).
- **Prompt kit**: generated *from* the package source (doc comments → function catalogue), so the system prompt never drifts from the real API. Includes Typst "dialect rules" (no Markdown syntax, escape `$`/`@`/`#`, allowed packages, no unbounded loops) and few-shot examples. Versioned with the package.
- **Answer keys without regeneration**: `inputs={{ showAnswers: "true" }}` → recompile, not re-prompt.

### 8.4 Render islands (interactive components inside Typst output)
Typst emits a marker; the renderer swaps in a React component:
- **html target**: `html.elem("typstream-island", attrs: (name: "mcq", props: json.encode(...)))` → React renders `islands.mcq` with props (e.g., interactive multiple choice in a student view, copy buttons, embedded video). Fallback content is the Typst rendering itself (so PDF/print still works).
- **paged target**: `#metadata((island: "mcq", ...)) <typstream-island>` + an engine `query` method (introspector positions of the labelled elements) → absolutely-positioned overlay over the SVG page.
- `BlockIncompleteContext` equivalent: islands get `isIncomplete` while their block is still streaming.

### 8.5 Engine adapters & renderer adapters
- `EngineAdapter` (§6.1): engine-wasm (default, our Typst build), server; typst.ts / typst-wasm possible via the conformance suite.
- `RendererAdapter`: `html-react` (default), `svg-pages`, `canvas-pages` (very long docs), `pdfjs` (server-produced PDF). Framework bindings beyond React (`@typstream/vue`, vanilla `mountTypstream(el, opts)`) only need the engine + a renderer.

### 8.6 Events & telemetry hooks
`onRendered({ rev, compileMs, healMs, patches, fixersApplied, fallbackLevel, pages })`, `onFallback`, `onWatchdog`. No telemetry is sent by the library itself; the app wires it. These events feed the corpus (§11.2) — every production fallback is a candidate test case (with consent/anonymization).

---

## 9. Security model

LLM output is **untrusted code**. Defense in depth:
- **Sandbox**: Typst has no network, no shell, no env; file access only through our VFS (only `main.typ`, preamble, mounted packages, app-provided images). `#read("/etc/passwd")` → "file not found". **Never use typst.ts's `FetchAccessModel`** for untrusted documents — it turns `#read`/`#image`/`#json` paths into same-origin fetches, letting LLM-written paths probe our static files; use a memory access model populated only by us. Package wasm plugins run inside Typst's sandboxed interpreter without host imports (re-verify for each Typst upgrade).
- **Compute**: watchdog + worker termination (§6.3); typst's own loop/recursion limits; per-compile budgets; max source size (default 1 MB); max pages for live preview (default 100).
- **Packages**: allowlist + pinned versions + integrity hashes; mirror-hosted.
- **Output sanitization**: HTML target → strict allowlist sanitizer (no `<script>`, no event handlers, no `style` with `url()` except data fonts; links limited to `http(s)`, `mailto`, in-doc `#anchors`); SVG target → same for `<a>`, no `foreignObject`. Image sources only from VFS/blob URLs.
- **CSP-friendly**: worker + wasm from same origin; no `eval`; document `wasm-unsafe-eval` requirement.
- **Privacy**: no third-party font/package fetching by default.
- Security test suite in §11.7.

---

## 10. Toolkit, editor-readiness & publishing

We won't build the editor or the wider tool family now, but v1 must not need a rewrite to get there. This section lists the constraints v1 code is held to, and how the published project (packages, landing page, docs) is organized.

### 10.1 The document model (shared by renderer, editor, AI and collaboration)
- **Source text is the single source of truth.** No parallel JSON document model that must round-trip; everything else (healed source, CST, artifact, editor view) is *derived* and carries a `revision`.
- **All changes are `TextEdit`s** (`{ from, to, insert }`, UTF-16 offsets, plus an optional origin tag: `"stream" | "user" | "ai" | "remote"`). Streaming, regenerate, editor keystrokes, AI rewrites and CRDT updates (Yjs `Y.Text` deltas map 1:1) all flow through the same `applyEdit` path in heal, syntax and engine.
- **Positions survive edits**: a `mapPosition(pos, edits)` utility in core (like ProseMirror's mapping) so selections, diagnostics, comments and island anchors can be carried across revisions.
- **Every derived artifact can be mapped back to source**: heal patches → `SourceMap`; compiled output → spans (§10.2). This is what makes click-to-edit, cursor sync and "explain this error" possible.

### 10.2 Render ↔ source mapping
- **Paged target**: frame items carry Typst spans. The engine exposes `resolve/span` (click position → source span, as `typst-ide`'s `jump_from_click` does) and `resolve/location` (span → page + position, as `jump_from_cursor` does).
- **HTML target**: Typst's HTML export carries no source spans today. v1 adds **block-level anchors**: in *preview* compiles only, the engine inserts an invisible `html.elem("typstream-anchor", attrs: (data-src: "<offset>"))` at each top-level checkpoint (§5.2); the renderer turns them into `data-typstream-src` attributes on the following block and strips them. Exports never contain anchors. Finer-grained mapping is a later upgrade (upstream span support or a wrapping show-rule strategy), behind the same `resolve/*` methods.
- Tested by a property: for every corpus doc and every top-level block, clicking the block resolves to a source range that contains the block's text.

### 10.3 What a future visual (Plate-style) editor needs — and the v1 contract that provides it
| Editor need | v1 provision |
|---|---|
| Structured view of the document | `@typstream/syntax` lossless CST with incremental reparse (oracle in v1, same package later). |
| Edits that preserve the author's formatting and comments | Edits are minimal text patches on the CST, never "serialize the whole model back to Typst". Typst code (functions, `#let`, show rules) stays as **opaque atomic nodes** rendered from compiled output, editable via a source popover — the markup subset (headings, paragraphs, emphasis, lists, math, tables) gets rich editing. |
| Live preview & validation while typing | Same engine, same scheduler, same fallback ladder — typing an unclosed `[` is the same problem as a streamed one. |
| AI commands ("simplify this paragraph", "add 5 questions") | Streaming *regions* (§5.2) + `@typstream/ai`. |
| Toolbars, slash menu, custom blocks | `editor` facet of `TypstreamPlugin` (§8.0), reserved now. `@typstream/edu` will contribute `question`, `mcq`, `answer` nodes. |
| Autocomplete, hover docs, go-to-definition | Language-service protocol methods (§6.1) reserved and capability-negotiated. |
| Collaboration | `TextEdit` ⇄ Yjs `Y.Text` adapter; positions mapped through edits. |
| Undo/redo | Owned by the editor over `TextEdit` history; engine is stateless per revision. |

Guardrails that keep v1 honest: (1) no module in `heal`/`engine`/`dom` may assume "append-only" — enforced by the random-edit property tests; (2) no React import below layer 4; (3) protocol and plugin types live only in `core` and are API-reviewed (§10.4).

### 10.4 Publishing & API stability
- **npm scope** `@typstream/*` plus the unscoped `typstream` convenience package. ESM-first with `exports` maps (subpath exports like `@typstream/engine/worker`), types bundled, `sideEffects: false`, CJS only where needed for Node consumers.
- **Versioning**: changesets; `core`/`heal`/`engine`/`dom`/`react`/`typstream` in a **fixed** version group (they evolve together, users never mix versions); content and integration packages version independently. Pre-1.0 we ship `0.x` with clear "experimental" labels on the HTML target and editor-facing APIs.
- **API review**: `api-extractor` reports checked into the repo; CI fails when the public surface changes without an updated report (the reviewer sees the diff). `@public` / `@beta` / `@internal` TSDoc tags drive both the reports and the docs.
- **Compatibility matrix**: each release declares its Typst version (engine-wasm build), supported browsers and React versions; documented on the website and asserted in CI.
- **Quality gates for publishing**: `publint`, `@arethetypeswrong/cli`, size budgets (§11.6), example apps build & smoke test, provenance (`npm publish --provenance`), signed commits (as streamdown does).
- **License**: decide before first publish (Apache-2.0 aligns with Typst and typst.ts; MIT is the streamdown/Plate norm). Track third-party licenses (fonts are OFL; bundle notices). If any part becomes commercial (e.g. a pro editor), keep the split at package boundaries, never inside a package.

### 10.5 Landing page, docs & playground (`apps/website`)
- **Stack**: Next.js + Fumadocs (MDX), same as streamdown's website; deployed with preview deployments per PR.
- **Dogfooding**: the landing page's hero is a live stream of a Typst worksheet rendered by typstream; every docs example is real Typst rendered by the library (so docs break when the library breaks — the docs build is a test).
- **Docs structure**: Getting started (React, Next.js + AI SDK, Vite, vanilla, Node) → Concepts (healing, streaming regions, render targets, fallback ladder, security) → Guides/recipes (answer keys, templates, custom islands, writing a plugin, server fix loop, self-hosting wasm/fonts/packages, CSP) → API reference (generated from TSDoc via api-extractor/typedoc → MDX) → `@typstream/edu` reference (generated from Typst doc comments — the same source as the prompt kit) → Playground → Changelog/compat matrix.
- **Playground**: paste or replay a stream, scrub through it token by token, see raw vs healed source with patches highlighted, diagnostics, fallback level and timings; shareable URLs (state in the hash). The internal dev playground and the public one are the same app with a flag.
- **Agent-readable docs**: `llms.txt` / markdown endpoints for every docs page (streamdown does this too), since our users build AI products.
- Docs are versioned per minor release once we hit 1.0.

---

## 11. Testing strategy

Tooling: **vitest** (unit/property/bench), **fast-check** (property), **Playwright** (browser e2e, visual, perf, cross-browser: Chromium/Firefox/WebKit), **typst CLI pinned in CI** + `typst-syntax` compiled to wasm as **parse oracle**, `size-limit`/esbuild script for size, CodSpeed or a stored-baseline comparator for benchmarks.

### 11.1 `@typstream/heal` — unit + property tests
- **Per-construct test files** (streamdown style): `strong.test.ts`, `emph.test.ts`, `raw-inline.test.ts`, `raw-block.test.ts`, `math-inline.test.ts`, `math-display.test.ts`, `math-calls.test.ts`, `content-block.test.ts`, `code-block.test.ts`, `args.test.ts`, `dict-array.test.ts`, `strings.test.ts`, `unicode-escape.test.ts`, `comments-nested.test.ts`, `labels.test.ts`, `refs.test.ts`, `statements-let-set-show.test.ts`, `closures.test.ts`, `control-flow.test.ts`, `embedded-expr-end.test.ts`, `urls-not-comments.test.ts`, `headings-lists-terms.test.ts`, `escapes.test.ts`, `surrogates.test.ts`, `fence-unwrap.test.ts`, plus one file per lint rule.
- **Table-driven expectations**: `{ input, healed, stableOffset, openFrames }` for ~1000 hand cases, including every row of §3 and §5.4.
- **Property tests over every prefix** (copy remend's method): generate documents from *complete* atoms (markup, math, code, tables, figures, raw blocks, edu functions, nested combos), then for every cut point assert invariants 1–6 of §5.4. Oracle for (1) = `typst-syntax` error-free parse (via `@typstream/syntax`, or the typstyle wasm `parse()` dump as a stopgap — search it for `Error` nodes). Additionally a **compile oracle** (sampled, slower): healed prefix compiles with zero errors via the real compiler with the edu package mounted.
  **As built (#13):** `tools/compile-oracle` (heal may not import the engine, §4.1), run in CI's engine job. It compiles one in three stream prefixes of the corpus and of generated documents to HTML; errors must be in an allowed class tied to the issue that removes it, a class that stops occurring must leave the list, and the corpus rate must stay above a floor. `pnpm --filter @typstream/compile-oracle report` runs the full measurement (§5.5 "Measured"). The edu package isn't mounted yet (#23).
- **Chunking fuzz**: same docs fed through `createHealer().push()` with random chunk sizes (1 char … 200 chars, incl. splits inside surrogate pairs and inside `\r\n`) → result must equal stateless `heal()` of the same prefix (**incremental ≡ stateless**).
- **Random-edit equivalence** (the editor-readiness guarantee): apply random `TextEdit` sequences (insert/delete/replace anywhere, incl. inside raw blocks, strings, math, nested code) via `applyEdit` → scanner state, checkpoints and regions must equal a full rescan of the resulting text; early-resync must actually trigger (assert rescanned length is bounded for local edits).
- **Streaming-region tests**: take a complete doc, delete a block, then stream it back in at its original position in random chunks → every intermediate healed document is valid, the suffix is byte-identical, and the final result equals the original.
- **Differential vs. tree-sitter-typst / typst-syntax for mode classification**: for random docs, our `mode(i)` must match the oracle's node kind at every offset (catches scanner drift when Typst syntax changes).
- **Mutation testing** (Stryker) on `heal` to keep the test suite honest; coverage ≥ 95% lines/branches for `heal`.

### 11.2 Corpus (shared by all layers)
`corpus/` holds real-world-shaped documents, each with metadata (`category`, `expectedPages`, `allowedWarnings`):
- **Hand-authored edu set** (~60): worksheets (math, science, language), MCQ quizzes, exams with answer keys, lesson plans, rubrics, reading comprehension, chemistry equations, physics with units, geometry with CeTZ, multilingual (Bengali, Arabic RTL, Chinese, Hindi), long reports with outline/bibliography.
- **LLM-generated set** (~300+, growing): generated with our prompt kit across several models and temperatures, recorded **with real chunk boundaries and timings** (`.stream.jsonl`), so tests replay exactly what production sees. Includes *broken* outputs (with the errors we expect to repair) — tagged by error class.
- **Adversarial set**: deep nesting (10k `[`), 1 MB document, 2000-row table, 500-page doc, pathological backtick runs, every Markdown-ism, infinite loops, memory bombs, huge images, zalgo text, RTL+LTR mixing.
- **Production regression set**: anonymized cases captured from fallback telemetry (§8.6).

**As built (#12):** `corpus/edu/` (35 hand-written documents, all compiling natively; geometry uses Typst's own shapes because packages wait on #25) and `corpus/adversarial/` (17 documents; the large ones are generated by `corpus/scripts/generate-adversarial.mjs`). `@typstream/corpus` loads entries, synthesizes token-sized streams and replays them through a callback (`corpus/README.md`). Findings from the first run:
- Heal bugs: a cut inside `else` / `else if` after an if-expression in a `#let`, and a `(_, y)` closure parameter list closed before `=>`. Both are listed as known bugs in heal's corpus test.
- The incremental healer is far over its per-token budget when nothing settles, even after the #5 resync: about 57 ms per token at the end of the 2,000-row table, 65 ms in the 200 KB single line, 11 ms in 10k-deep nesting. A large `#table(` is one unsettled construct.
- Native layout of the 200 KB single paragraph takes about 12 s; the 1 MB document (479 pages) about 18 s.
- Typst stops `while` loops ("loop seems to be infinite") and deep recursion by itself, and rejects `while true` statically. Memoization collapses `f(n - 1) + f(n - 1)`. Long finite loops, recursion with distinct arguments, and memory bombs are left to the engine's watchdog (§6.3).

### 11.3 Engine tests (Node + browser)
- Scheduler unit tests with fake timers & fake adapter: latest-wins, stale-result dropping, adaptive interval math, boundary bias, cancellation on unmount.
- Watchdog tests: infinite-loop doc → worker terminated within budget + spare worker takes over + fallback shown; 3-strikes behavior.
- Semantic fixers: per-fixer tests driven by **real compiler diagnostics** (no mocks — pin compiler version so messages are stable; snapshot the diagnostic shape to detect upstream changes).
- **Fallback ladder**: injected failures at each level; block isolation finds the right block(s) with ≤ ⌈log₂ n⌉+1 compiles.
- **Final-render equivalence**: for every corpus doc, replay the stream through the full pipeline; the final artifact must equal a one-shot compile of the full source (HTML string equality; paged: vector hash equality).
- **Protocol contract tests**: a shared conformance suite every `EngineAdapter` (typst.ts, server, future custom wasm) must pass — same requests, same diagnostics shape, same artifacts; version/capability negotiation tested old-client↔new-server and vice versa.
- **Plugin contract tests**: a plugin using every facet loads in engine + dom + react; unknown facets (e.g. `editor`) are ignored without error; plugin ordering/dependencies resolved deterministically.
- **Source-mapping tests**: every top-level block's anchor resolves to a source range containing its text (HTML); `resolve/span` round-trips on paged output; `mapPosition` through random edits matches a naive recomputation.
- **Streaming quality metrics** (reported, with thresholds): prefix-compile rate, fallback-level histogram, max consecutive stale frames, mean visible lag (tokens received but not yet rendered).

### 11.4 Rendering & visual tests (Playwright)
- **Visual regression**: screenshot every corpus doc (final) in both targets × light/dark × 3 widths; plus **mid-stream frames** at fixed cut points (25/50/75%) — catches flicker artifacts like a half-applied show rule. Pixel-diff threshold; baselines updated via explicit command.
- **Flicker test**: record DOM mutations during replay; assert no element that was already settled (above `stableOffset`) is removed/re-created (layout stability), and no CLS beyond a threshold in the HTML target.
- **html-compat coverage**: for each Typst element in a matrix (grid, align, rect, box, block, place, columns, stack, table features, figure kinds, outline, footnote, bibliography, equation numbering, cetz), compile to HTML and assert (a) no "ignored during HTML export" warnings, (b) no text content lost vs. paged text extraction.
- **Accessibility**: axe-core on HTML target; heading order, MathML presence, table headers, `lang`/`dir`; paged target exposes a text layer & document outline.
- Cross-browser matrix incl. WebKit (Safari MathML/wasm memory quirks) and a mobile viewport profile.

### 11.5 Performance tests
Bench suites (vitest `bench`, stored baselines, CI fails on > 10% regression on a dedicated runner or via CodSpeed):
- **heal micro**: per-construct ns/op; **scaling** at 1 KB / 10 KB / 100 KB / 1 MB (must be linear; fit slope); **per-token incremental cost** vs. full rescan over a 50 KB replay (incremental must be ≥ 20× cheaper at the tail of the stream).
- **engine (Node, wasm)**: cold init (instantiate + fonts), first compile, incremental recompile after appending 1 / 10 / 100 chars for 1 / 5 / 20 / 100-page docs, p50/p95/p99, both targets; semantic-fixer overhead; block isolation cost.
- **end-to-end (Playwright + CDP tracing)**: replay corpus streams at 30, 100 and 300 tokens/s; measure time-to-first-render (cold/cached), compile→paint latency, **long tasks on main thread (must be 0 > 50 ms)**, total main-thread busy %, FPS during auto-scroll, worker CPU; CPU-throttled 4× profile to simulate low-end school laptops/Chromebooks.
- **Memory/leak**: 200 compiles of a changing document per adapter (catches comemo-cache growth like typst.ts #895; asserts worker recycling keeps wasm memory under its threshold); stream 50 docs sequentially in one page, heap snapshots before/after (detached DOM nodes, worker memory, wasm memory growth); unmount/remount 100 times.
- **Concurrency**: 10 `<Typstream>` instances on one page (chat history) — shared worker pool (default pool size 1–2), only visible/streaming instances compile.

### 11.6 Size tests
Budgets checked in CI with a report comment on PRs (like streamdown's `scripts/bundle-size.js`, but enforced):
| Artifact | Budget (gz unless noted) |
|---|---|
| `@typstream/heal` | ≤ 15 KB (measured 13.9 KB; the faithful parser port is most of it) |
| `@typstream/react` (excl. engine, peers external) | ≤ 15 KB |
| `@typstream/engine` main-thread part | ≤ 8 KB |
| Worker JS (excl. wasm) | ≤ 40 KB |
| Compiler wasm (brotli) | ≤ 6.0 MB for `engine-wasm` (HTML+SVG); Phase 0 baseline 5.86 MB, 4.29 MB with trimmed data; alert on +3% |
| Renderer wasm (brotli) | ≤ 400 KB (typst.ts renderer 0.8.0-rc3 is 372 KB) |
| Syntax wasm (`@typstream/syntax`, gz) | ≤ 300 KB; never loaded by the renderer-only path |
| Base font payload | ≤ 1.5 MB (brotli), lazy script fonts tracked individually |
| `@typstream/edu` Typst package | ≤ 30 KB |
Plus: tree-shaking test (importing `heal` alone pulls nothing else), "no wasm in main bundle" assertion, ESM/CJS export map tests, `publint`/`attw` checks.

### 11.7 Security tests
Corpus of hostile docs: file reads outside VFS, package imports not on allowlist, `javascript:` / `data:` links, SVG/HTML injection attempts via `html.elem("script")`, `html.elem` with `onclick` attrs, huge allocations, deep recursion, infinite layout (e.g. self-referential `context` loops / layout not converging) → assert sandbox holds, sanitizer strips, watchdog fires, UI recovers.

### 11.8 CI pipeline
`lint (biome) → layering check (dependency-cruiser) → typecheck → unit+property (heal, engine, core) → build → api-extractor diff → publint/attw → size → node benches (compare) → Playwright (e2e, visual, a11y, perf smoke) → examples build + smoke → website build (docs examples render through the library) → corpus report artifact (prefix-compile rate, fallback histogram, perf table)`. Nightly: full perf suite, long property runs (10× examples), mutation testing, cross-browser full matrix, LLM corpus refresh (regenerate N new docs with current prompt kit & models, run the pipeline, file new failures as test cases).

---

## 12. Observability in production
The app (not the library) collects, via `onRendered`/`onFallback`/`onDiagnostics`: heal patch counts by rule, fixer hits by diagnostic, fallback levels, watchdog events, compile latency by doc size and device class, final-mode errors after the LLM fix loop. Weekly review → new lint rules / prompt kit "don'ts" / corpus cases. Target: final-mode error rate (after fix loop) < 0.5% of generated documents.

---

## 13. Repository layout & tooling

```
typstream/
  packages/
    core/          src/{edits,positions,sourcemap,diagnostics,protocol,plugin,errors}.ts   (no deps)
    heal/          src/{normalize,scanner,frames,checkpoints,lint/*,tail,region,index}.ts  __tests__/  __benchmarks__/
    syntax/        wasm wrapper over typst-syntax (oracle now, editor CST later)
    engine/        src/{client,scheduler,watchdog,pool}.ts  src/worker/{server,vfs,fonts,packages,fixers/*,fallback,anchors}.ts
                   src/adapters/{typst-ts,server}.ts
    node/          src/{validate,render,fix-loop,format-diagnostics}.ts
    html-compat/   typst/html-compat.typ  (+ coverage matrix tests)
    edu/           typst/{lib.typ,templates/*.typ}  prompt-kit/  plugin.ts  scripts/gen-catalogue.ts
    dom/           src/{mount,renderers/{html,svg-pages}/*,sanitize,animate,caret}.ts
    react/         src/{Typstream.tsx,provider.tsx,use-typstream.ts,islands.tsx}
    typstream/     re-exports (convenience package)
    ai/            (v1.x)    codemirror/, editor-core/, editor-react/   (future — directories created only when work starts)
  apps/
    website/       Next.js + Fumadocs: landing page, docs, public playground, llms.txt
    playground/    internal dev playground (same code as public playground behind a flag) + corpus recorder
  examples/        nextjs-ai-sdk/  vite-react/  vanilla/  node-validate/   (built & smoke-tested in CI)
  corpus/          edu/ llm/ adversarial/ regressions/   (*.typ, *.stream.jsonl, meta.json)
  bench/           e2e perf harness (Playwright + CDP)
  tools/           typst-syntax-wasm build, size report, benchmark baseline compare, api-extractor config
```
pnpm workspaces, turbo, tsup, vitest, biome (ultracite), changesets, Playwright, api-extractor, dependency-cruiser (layering rules from §4.1); Rust toolchain only for the `syntax` wasm and the optional custom compiler wasm. Shared `tsconfig`/build presets so a new package (e.g. `editor-core`) is a copy-and-rename.

---

## 14. Roadmap (phased, each with exit criteria)

> The phases below are the original plan. **The authoritative, up-to-date breakdown is the GitHub issues** (roadmap: #38). Issue numbers are noted per phase.

**Phase 0 — Spikes**
- ✅ **Engine bake-off done** (2026-10-26, [spikes/phase0/RESULTS.md](spikes/phase0/RESULTS.md)). typst.ts 0.8.0-rc3, typst-wasm 1.0.0 and our own Typst 0.15.1 build were measured in Chromium 156, Firefox 157 and WebKit 27.2 for size, cold start, streaming latency at 1/5/20 pages, main-thread render cost, and memory over 200 compiles. **Decision: own the engine build; HTML is the default streaming target** (§6.1).
- Remaining:
  - ✅ Changed-page SVG export prototyped. It meets the bar, so typst.ts is dropped (see RESULTS.md, "Changed-page SVG prototype").
  - Decide the data-trimming level: hyphenation languages, highlighting, bibliography and plugins (4.29 MB measured; ~2.5 MB estimated).
  - ~~Measure on real low-end hardware~~: deferred (see decision log).
  - html-compat prelude coverage and MathML rendering across browsers: moved to Phase 3.
  - ✅ `typst-syntax` wasm oracle built (`tools/typst-syntax-oracle`).
- *Exit*: data-trimming level decided (needs the launch-languages decision).

**Phase 1 — `@typstream/heal`** ✅ (2026-10-26; see `packages/heal/README.md`)
- Built:
  - `@typstream/core`: edits, positions, source maps.
  - `@typstream/heal`: normalizer, recognizer (typst-syntax port), incremental healer with checkpoints, tail repair, streaming regions, 9 lint rules, custom handlers.
  - `tools/typst-syntax-oracle`: Typst's real parser as a test oracle.
- Tests: 119 (heal) + 4 (core).
  - Properties: validity, preservation, idempotence, identity, chunking ≡ stateless, random edits ≡ stateless, streaming regions.
  - Recognizer ≡ typst-syntax on documents, prefixes and character soup.
  - All 21 property and edge-case tests passed a 10,000-run campaign (millions of healed prefixes checked by Typst's parser). An earlier 20,000-run campaign found no violations; one test only hit the old 120 s timeout, which is now raised for long runs.
  - Coverage: 97.6% lines, 92% branches.
- Perf: per token at 40–50 KB p50 0.16 ms / p95 0.2 ms; stateless healing is linear (~85 µs/KB up to 1 MB); pathological inputs under 75 ms.
- Not done yet:
  - ✅ Compile-oracle tests (healed prefixes compile with the engine): `tools/compile-oracle`, #13.
  - Mutation testing.
  - CI (the repo isn't under git yet).

**Phase 2 — Engine MVP (2–3 wks)** · issues #7–#14
- Worker + `@typstream/engine-wasm` (productionize the Phase 0 crate: CI wasm build, eviction after every compile, changed-page SVG, structured diagnostics), VFS, base fonts, scheduler, watchdog, last-good fallback, paged target with visible-pages-first updates.
- *Exit*: corpus replays with 0 error screens; perf SLOs for 5-page docs met in Chromium.

**Phase 3 — React + HTML target (2–3 wks)** · issues #15–#19
- `<Typstream>`, HTML renderer with block diffing, sanitizer, html-compat, animation/caret, exports.
- *Exit*: visual + a11y suites green; final-render equivalence 100%.

**Phase 4 — Semantic fixers, block isolation, final mode, `@typstream/node` fix loop (2 wks)** · issues #20–#22
- *Exit*: prefix-compile rate ≥ 99%; final-mode recovery shows full doc with isolated error blocks.

**Phase 5 — `@typstream/edu` + prompt kit + templates (2–3 wks, can start in parallel with 2)** · issues #23–#24
- *Exit*: LLM corpus generated with the kit has < 2% raw final-mode error rate before fix loop.

**Phase 6 — Hardening & extensibility** · issues #25–#30
- Islands, lazy script fonts, package allowlist & mirror, cross-browser. (Low-end perf deferred; see decision log.)

**Track W — Website & docs (runs alongside Phases 2–6)** · issues #31–#33
- Phase 2: `apps/website` scaffold (Fumadocs), landing page with live streamed demo, Getting started.
- Phase 3–4: Concepts + API reference generation, public playground.
- Phase 5: `@typstream/edu` reference generated from Typst doc comments; recipes; `llms.txt`.
- *Exit for first public release (0.1)*: docs cover every `@public` API, examples green, compat matrix published.

**Later — the wider toolkit (not scheduled; v1 contracts already support them)** · issues #34–#37
- `@typstream/ai`: AI SDK integration, streaming *regions* for "rewrite this section" commands.
- `@typstream/codemirror`: source editor with highlighting, diagnostics, completion/hover via the language service.
- `@typstream/editor-core` / `editor-react`: Plate-style visual editor over the CST (markup subset rich-editable, code as atomic nodes), edu nodes via the plugin `editor` facet.
- Collaboration adapter (Yjs), Vue/Svelte bindings over `@typstream/dom`.

---

## 15. Risks & open questions

| Risk | Mitigation |
|---|---|
| **Wasm + fonts payload** heavy for school devices / slow networks (≈ 5.9 MB engine + 1.45 MB fonts brotli; ~3 s at 20 Mbps) | Preload while the LLM is still generating, cache forever, hybrid server-first mode, lazy PDF module. |
| **Memory growth from Typst's memoization cache** (typst.ts #895 confirmed in all browsers: +1.3 MB/compile) | Our build evicts after each compile (flat ~21 MB, measured); recycling for other adapters (§6.3); 200-compile memory test in CI (§11.5). |
| Owning a Rust/wasm build adds maintenance (Typst upgrades, wasm toolchain) | Small surface (~350 lines); pinned toolchain in CI; Typst-upgrade playbook; typst.ts/typst-wasm adapters remain drop-in fallbacks via the conformance suite. |
| Paged target jank on long documents (multi-page reflows: 40–70 ms when 7 pages change) | Changed-page export (measured: usually 1 page per step); visible-pages-first DOM updates, offscreen pages in idle time; typst.ts adapter possible as fallback. |
| **HTML export is experimental upstream**; output changes between versions | Pin Typst version per typstream release; html-compat + visual tests catch changes; `paged` remains reference. |
| **Typst syntax/diagnostic changes** break scanner & fixers | Oracle-differential tests against pinned `typst-syntax`; diagnostic snapshot tests; upgrade playbook per Typst release. |
| **LLM writes complex code** (loops, heavy CeTZ) → slow compiles | Watchdog, adaptive throttle, prompt kit constraints, "too complex for live preview" mode. |
| Global show/set rules arriving late cause **restyle flashes** | Tail repair drops incomplete global rules; prompt kit asks for all `#set`/`#show` at the top; templates set style up front. |
| Forward refs/outline cause numbers to shift during stream | Pending-ref placeholders; acceptable by design; final render exact. |
| Typst versions: typst.ts lags the latest Typst release (`latest` is still on 0.14.2; 0.15 only in `rc`) | Pin per adapter and declare it in the compat matrix; custom wasm adapter as escape hatch; heal/lint tests run against the *same* pinned `typst-syntax` as the engine. |
| **Over-engineering v1 for a future editor** slows the product launch | Only *contracts* are built now (edit-based APIs, protocol types, plugin facets, block anchors); editor packages are reserved names with no code. Each contract has a test that keeps it honest, and nothing editor-specific ships in the bundle. |
| HTML target lacks fine-grained source spans → weak click-to-edit in a future visual editor | Block-level anchors in v1; paged target has full spans; track upstream HTML span work; editor can fall back to paged preview. |
| Publishing a public API too early locks in mistakes | `0.x` with `@beta` tags, api-extractor review on every change, editor-facing APIs marked experimental until the editor exists. |

Open questions for the product team:
1. Primary surface: chat bubbles (favor `html`) or document side-panel (favor `paged`)? Likely both — confirm default.
2. Which languages/scripts must be supported at launch (drives font payload)?
3. Is server-side compile acceptable as a fallback for low-end devices (cost, latency)?
4. Which Typst packages do teachers need on day one (CeTZ for diagrams? chemistry? music notation?)
5. Do students interact with documents (islands for quizzes), or is it teacher-only output?
6. Licensing and open-source scope: fully open (Apache-2.0/MIT), or open core with a commercial editor later? This decides package boundaries before the first publish.
7. Product name and npm scope availability (`typstream`, `@typstream/*`) — reserve them early.
