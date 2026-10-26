# CLAUDE.md

Typstream renders LLM-streamed **Typst** live in the browser, for an AI tool that writes educational documents (worksheets, quizzes, exams). It's planned as a published toolkit (`@typstream/*`), with an editor, website and docs to come later.

## Where things are decided

- **`PLAN.md`** is the design: architecture, decisions and roadmap. Read *Status & decisions* at the top first; then the sections an issue links to. Some sections keep their original design sketch next to an "As built" note. The note wins.
- **GitHub issues** are the work queue (`gh issue list`). Each one names its context, the PLAN sections to read, dependencies, and acceptance criteria. Issues labelled `research` start with an investigation whose findings you post on the issue before building. The pinned roadmap issue [#38](https://github.com/ikramhasan/typstream/issues/38) lists everything in order, and [#1](https://github.com/ikramhasan/typstream/issues/1) holds open product decisions. CI, release and tooling issues: #2–#4.
- When you make or learn a decision that changes the plan, update the *Status & decisions* log in `PLAN.md` in the same PR.

## Layout

```
packages/core     @typstream/core: TextEdit, positions, SourceMap. No dependencies; contracts only.
packages/heal     @typstream/heal: normalizer, recognizer (port of typst-syntax 0.15.1), tail repair, lint, incremental healer.
packages/engine   @typstream/engine: main-thread client (heal → scheduler → worker, watchdog, recycling, last-good), and
                  the worker half (`/server`: protocol server, EngineAdapter, engine-wasm adapter; `worker.ts`, spawned by `engineWorker()`).
packages/engine-wasm  @typstream/engine-wasm: Typst 0.15.1 as wasm (Rust crate + wasm-bindgen glue): HTML, changed-page SVG, UTF-16 diagnostics.
packages/html-compat  @typstream/html-compat: Typst prelude + CSS so HTML export keeps grid, align, shapes, place, … (tests need the engine).
packages/dom      @typstream/dom: framework-free renderers. `src/html/`: HTML renderer (string block split, sanitizer, source
                  anchors, word fade-in, caret, theme CSS).
tools/typst-syntax-oracle   Typst's real parser compiled to wasm for Node; the ground truth in heal's tests.
tools/compile-oracle        Do healed prefixes compile? heal × engine-wasm over the corpus; error classes and the prefix compile rate.
tools/repo        Repo tooling: package layer table (layers.mjs), layering check, shared tsup and api-extractor configs.
corpus/           @typstream/corpus (private): shared test documents (edu/, adversarial/), meta.json, stream replay.
apps/playground   Dev playground (Vite + React): replay streams, inspect healing, record corpus cases. Heal-only for now.
spikes/phase0     Throwaway Phase 0 experiments: browser harness (harness/) and custom Typst wasm engine (custom-engine/).
                  Port code out of here into packages/; don't import from spikes.
PLAN.md           Design and roadmap.
```

Planned packages and their dependency layers are in PLAN.md §4.1. Rules: `core` has no dependencies; nothing below the bindings layer imports React; protocol and plugin types live in `core`. `pnpm check:layers` enforces them from the table in `tools/repo/layers.mjs`: a package may import only the packages in its row's `deps` (the §4.1 "Deps" column). Apps (`apps/*`) may import any package; packages never import apps.

## Setup and commands

Toolchain:
- Node ≥ 20 (developed on 25).
- pnpm 12.
- For the oracle and engine: Rust ≥ 1.92 (Typst 0.15.1 needs it), the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` at **exactly** the `wasm-bindgen` version in the crate's `Cargo.lock` (currently 0.2.129).
- `binaryen` (`wasm-opt`) for the engine.
- The native `typst` CLI **0.15.1** on `PATH` for engine-wasm's tests (they compare output with it).

```bash
pnpm install
pnpm oracle            # build tools/typst-syntax-oracle (needed before heal's tests run)
pnpm build             # turbo: all packages
pnpm test              # turbo: all packages
pnpm check-types
pnpm check             # Biome lint + format check (pnpm fix to apply)
pnpm check:layers      # package layering (dependency-cruiser) + package.json deps + changesets fixed group
pnpm check:api         # public API must match packages/*/api/*.api.md; pnpm api:update to accept a change
pnpm check:packages    # publint + @arethetypeswrong/cli on the built packages
pnpm changeset         # describe a change to a published package
pnpm corpus:validate   # native `typst` 0.15.1 compile of every corpus entry (needs typst on PATH or TYPST=)
```

In `packages/engine-wasm` (Rust build, ~3 min cold):
- `pnpm build`: `build.sh` → `dist/` (glue, `.d.ts`, `wasm-opt -Oz` wasm, base fonts from typst-assets). It skips the build when `dist/` came from the same inputs (`FORCE=1` rebuilds). The root `pnpm test` / `pnpm check-types` (turbo) build it first; run inside the package, `pnpm test` uses the existing `dist/`.
- `pnpm size`: wasm budget, 6.0 MB brotli.
- It isn't a tsup package: `dist/` is wasm-bindgen's output, and its API report reads `dist/engine.d.ts`, whose types are written in `src/lib.rs`. Only the `Engine (wasm)` CI job runs its own checks; the other jobs pass `--filter=!@typstream/engine-wasm`, but `@typstream/engine` depends on it, so turbo still builds it there: they restore `dist/` with `.github/actions/engine-wasm` (cached on the crate's inputs), and `build.sh` then has nothing to do.

In `packages/engine`:
- `pnpm test`: the `node` vitest project (client against a fake worker; server and protocol conformance against engine-wasm in-process). Needs engine-wasm's `dist/`.
- `pnpm test:browser`: the `browser` project, the real worker in Chromium, Firefox and WebKit (vitest browser mode, Playwright). `BROWSERS=chromium` runs one.
- `pnpm size`: main thread ≤ 8 KB, worker JS ≤ 40 KB gzipped.
- Two API reports: `api/engine.api.md` (main entry) and `api/engine-server.api.md` (`@typstream/engine/server`).

In `packages/html-compat`:
- Edit `typst/html-compat.typ` / `css/html-compat.css`, then `pnpm embed` to regenerate `src/assets.generated.ts` (a test checks it).
- Its tests compile with engine-wasm (a `testDeps` entry in `tools/repo/layers.mjs`) and compare with native `typst` + pdf.js, so they run in CI's `Engine (wasm)` job, not the general test job.

In `packages/dom`:
- `pnpm test`: node tests (the HTML block splitter). `pnpm test:browser`: the renderers in Chromium, Firefox and WebKit, fed by the real engine worker with html-compat and corpus documents (needs engine-wasm's `dist/`). `BROWSERS=chromium` runs one.
- `pnpm size`: HTML renderer ≤ 9 KB gzipped, with its CSS.
- Its API report needs DOM types, so its `api-extractor.json` overrides the shared compiler settings.

In `packages/heal`:
- `pnpm test:long`: 20,000-run property campaign (minutes).
- `pnpm bench`: vitest benchmarks.
- `node scripts/perf.mjs`: asserts the latency budgets; run `pnpm build` first. `PERF_TOLERANCE=3` (what CI uses) fails only above 3× budget.
- `pnpm size`: bundle budget, 15 KB gzipped.

Compile oracle (`tools/compile-oracle`, needs the built engine): `pnpm turbo run test --filter=@typstream/compile-oracle`; `pnpm --filter @typstream/compile-oracle report` for the full measurement (minutes).

CI (`.github/workflows/ci.yml`) runs the same commands on every PR, building the oracle through `.github/actions/oracle` and engine-wasm through `.github/actions/engine-wasm` (both cached on the crate's inputs), plus the engine's browser tests. `nightly.yml` runs `test:long`.

Adding a package: copy `packages/core` and rename. Its `tsconfig.json`, `tsup.config.ts` and `api-extractor.json` only extend the shared configs (`tsconfig.base.json`, `tools/repo/`), and `@typstream/*` resolves to `packages/*/src` through a wildcard path. Then add its row to `tools/repo/layers.mjs`, and add it to the `fixed` group in `.changeset/config.json` if the row says `fixed`. Delete the copied `api/core.api.md` but keep `api/` (api-extractor won't create it), then `pnpm api:update` writes the new package's report.

In `apps/playground` (PLAN.md §10.5, #31):
- `pnpm --filter playground dev`: Vite dev server on http://localhost:5173. No build needed first: `@typstream/*` resolves to `packages/*/src` (see `vite.config.ts`), so heal edits hot-reload.
- Load a corpus entry, paste a document or `.stream.jsonl`, or open one from disk. Scrub by chunk, token or character (arrows, Shift for 10, Home/End, Space plays at the recorded timing). The panes show raw input vs healed source with patches, open frames, the settled boundary, lint findings and syntax errors; the inspector has per-step and whole-stream push timings against the §1 budget.
- The URL hash holds the whole state (source, seed, split, step, options), so a link reproduces a case. "Save as corpus case" downloads `.typ` + `.stream.jsonl` and shows the `meta.json` entry to add.
- The dev and preview servers send COOP/COEP headers: without cross-origin isolation browsers round `performance.now()` to 0.1 ms, too coarse for heal's timings. The first profile after a load includes JIT warm-up; use "re-run".
- `pnpm --filter playground build` (static `dist/`), `test`, `check-types`. The render pane is a slot until the engine worker (#10) and React bindings (#17) land.

Spikes (reference only):
- Custom engine: `spikes/phase0/custom-engine/build.sh <variant>`.
- Browser harness: `cd spikes/phase0/harness && npm i && node build.mjs && node run.mjs [filters]`. It needs Playwright's Chromium, Firefox and WebKit.

## Conventions

- **Typst is pinned to 0.15.1** everywhere: oracle, engine crate, recognizer port. Upgrading is a deliberate task: update all three and re-run the long property tests.
- **Offsets in JS APIs are UTF-16 indices** (JS string indices). Rust/Typst spans are UTF-8 bytes; convert at the wasm boundary.
- TypeScript strict, ESM, `verbatimModuleSyntax`. Biome formats (line width 120). Match the surrounding code's comment density: explain *why*, cite parser.rs/lexer.rs functions when porting.
- **Test against real Typst, not expectations of it.** Heal's tests check outputs with the oracle (`__tests__/support/oracle.ts`). Engine work should add a compile oracle the same way.
- New test documents go in `corpus/` with a `meta.json` entry, and `pnpm corpus:validate` must pass (see `corpus/README.md`). Heal's tests run every corpus document.
- Property tests build documents from **complete** constructs (`__tests__/support/generators.ts`) and derive truncation from the streaming cut. Every bug fix adds a row to `constructs.test.ts` or a case to the generators.
- Healing invariants must keep holding (PLAN.md §5.4): healed prefixes parse; settled text is untouched; healing is idempotent; valid documents come back unchanged; incremental, chunked and edited results equal stateless healing.
- Performance budgets in PLAN.md §1 and §11.5–11.6 are enforced by scripts. Don't regress them silently.
- **Public API is reviewed through the API reports** (`packages/*/api/*.api.md`). Exports without a release tag are `@public`. Tag unstable ones `@beta`, and things exported only for other typstream packages or for heal's own plumbing `@internal`. Commit the updated report with any API change.

## Gotchas

- **The file-writing tool may decode `\uXXXX` escapes in source into literal (often invisible) characters** (U+2028, U+200B, combining marks). Write such escapes from a script, or scan afterwards: categories Zl, Zp, Cf, Mn, Cs, Cc in `.ts` files should be zero.
- pnpm 12 blocks install scripts unless listed in `allowBuilds` in `pnpm-workspace.yaml` (esbuild is).
- The oracle's `pkg/` needs a `{"type":"commonjs"}` `package.json` (its build script writes it), because the repo root is ESM.
- Typst's memoization cache grows with every compile unless the engine calls `comemo::evict(2)` **after every compile** (Phase 0: flat ~21 MB vs +2 MB/compile).
- Chrome DevTools CPU throttling doesn't slow Web Workers. Worker timings under CDP throttling aren't low-end numbers.
- typst-wasm (npm) only accepts relative paths (`main.typ`) and needs COOP/COEP or JSPI. typst.ts's `render_svg` panics on normal documents (use `render_svg_diff`). Details in `spikes/phase0/RESULTS.md`.
- Typst's page frame hashes include source spans: the same text, parsed afresh or reparsed incrementally, can hash differently. Compare page SVGs, not hashes, when checking that two compiles look the same.
- Streaming most corpus documents produces compile-error frames (a cut `#question(` heals to `#question()`); heal's invariants are about parsing, not compiling. Engine tests that assert "no error frames" use documents checked at every prefix (`packages/engine/__tests__/support/documents.ts`).
- The shell prints a zoxide warning on every command; set `_ZO_DOCTOR=0` to silence it.
