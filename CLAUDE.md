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
                  the worker half (`/server`: protocol server, EngineAdapter, engine-wasm adapter, Layer 3 fixers, Layer 4
                  fallback (block isolation, stable prefix) and the Typst runtime library they insert; `worker.ts`, spawned
                  by `engineWorker()`).
packages/engine-wasm  @typstream/engine-wasm: Typst 0.15.1 as wasm (Rust crate + wasm-bindgen glue): HTML, changed-page SVG, PDF, UTF-16 diagnostics.
packages/html-compat  @typstream/html-compat: Typst prelude + CSS so HTML export keeps grid, align, shapes, place, … (tests need the engine).
packages/universe @typstream/universe: the Typst Universe packages allowed by default (CeTZ, fletcher, cetz-plot, physica, unify,
                  chemformula, alchemist), vendored tarballs + integrity, as an allowlist plugin. The engine loads packages
                  in `packages/engine/src/server/packages.ts`.
packages/edu      @typstream/edu: the Typst vocabulary for teachers' documents (templates, questions, answers and keys, callouts,
                  rubrics, drawings, `ce`), its CSS and prompt catalogue, as a plugin (tests need the engine and native typst).
packages/dom      @typstream/dom: framework-free renderers. `src/html/`: HTML renderer (string block split, sanitizer, source
                  anchors, word fade-in, caret, theme CSS). `src/paged/`: SVG pages (changed pages, visible first, text layer).
                  `src/mount.ts`: `mountTypstream`, a document on an engine in an element (what the bindings wrap).
                  `src/export/`: `standaloneHtml`, a downloadable file from an HTML export (theme, CSS, CSP).
packages/react    @typstream/react: <Typstream>, TypstreamProvider, useTypstream(); a thin layer over mountTypstream.
packages/typstream  typstream: the convenience package (<Typstream> with html-compat, the math font and universe's packages; re-exports).
tools/typst-syntax-oracle   Typst's real parser and lexer compiled to wasm for Node; the ground truth in heal's tests.
tools/compile-oracle        Do healed prefixes compile? heal × engine-wasm over the corpus, then the engine's fixers and fallback;
                            error classes, the prefix compile rate, and final-mode renders of every corpus document.
tools/llm-corpus  Real model output (#24): records Claude streams with edu's prompt kit, measures final-mode compile errors,
                  promotes recordings into corpus/llm.
tools/browser-suites  Corpus-wide browser suites (#19): final-render equivalence, flicker, accessibility (axe), and visual
                    regression against baselines rendered in Playwright's Docker image.
tools/repo        Repo tooling: package layer table (layers.mjs), layering check, shared tsup and api-extractor configs.
corpus/           @typstream/corpus (private): shared test documents (edu/, adversarial/, llm/), meta.json, stream replay.
apps/playground   Dev playground (Vite + React): replay streams, inspect healing and the engine's raw output, record corpus cases.
examples/         node-validate (@typstream/node fix loop), nextjs-ai-sdk (useChat → <Typstream>, Next.js App Router),
                  strict-csp (both targets under a strict Content-Security-Policy, checked in three browsers).
spikes/phase0     Throwaway Phase 0 experiments: browser harness (harness/) and custom Typst wasm engine (custom-engine/).
                  Port code out of here into packages/; don't import from spikes.
apps/website      The website (#32, #33): landing page and docs (Next.js + Fumadocs). content/docs/ holds every page as MDX,
                  the user-facing guides included (security, writing a plugin); llms.txt and a Markdown twin of each page.
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
- `pnpm build`: `build.sh` → `dist/` (glue, `.d.ts`, `wasm-opt -Oz` wasm, base fonts from typst-assets, and the lazily loaded script fonts, downloaded from notofonts at a pinned commit and SHA-256 checked, with their `FontInfo` registry written by `scripts/fonts.mjs`). It skips the build when `dist/` came from the same inputs (`FORCE=1` rebuilds). The root `pnpm test` / `pnpm check-types` (turbo) build it first; run inside the package, `pnpm test` uses the existing `dist/`.
- `pnpm size`: wasm budget, 6.3 MB brotli (HTML, SVG and PDF in one build since #18).
- It isn't a tsup package: `dist/` is wasm-bindgen's output, and its API report reads `dist/engine.d.ts`, whose types are written in `src/lib.rs`. Only CI's `Engine (wasm, html-compat, edu)` job runs its own checks; the other jobs pass `--filter=!@typstream/engine-wasm`, but `@typstream/engine` depends on it, so turbo still builds it there. Every job restores `dist/` with `.github/actions/engine-wasm` (cached on the inputs `build.sh` hashes; it builds with Rust on a miss), and `build.sh` then has nothing to do.

In `packages/engine`:
- `pnpm test`: the `node` vitest project (client against a fake worker; server and protocol conformance against engine-wasm in-process). Needs engine-wasm's `dist/`.
- `pnpm test:browser`: the `browser` project, the real worker in Chromium, Firefox and WebKit (vitest browser mode, Playwright). `BROWSERS=chromium` runs one.
- `pnpm size`: main thread ≤ 8.5 KB, worker JS ≤ 40 KB gzipped.
- Two API reports: `api/engine.api.md` (main entry) and `api/engine-server.api.md` (`@typstream/engine/server`).

In `packages/html-compat`:
- Edit `typst/html-compat.typ` / `css/html-compat.css`, then `pnpm embed` to regenerate `src/assets.generated.ts` (a test checks it).
- Its tests compile with engine-wasm (a `testDeps` entry in `tools/repo/layers.mjs`) and compare with native `typst` + pdf.js, so they run in CI's `Engine (wasm, html-compat, edu)` job, not the general test job.

In `packages/universe`:
- `vendor/` holds the `.tar.gz` files exactly as packages.typst.org serves them (committed). `integrity` is the SHA-256 of the *uncompressed* tar, because servers often send `.gz` with `Content-Encoding: gzip`.
- `node scripts/vendor.mjs name:version` adds one and prints its integrity; `--check` compares every tarball with upstream (network). The tests check the hashes and that every package a vendored one imports is vendored too.
- The engine's Node tests and html-compat's matrix mount these packages; html-compat's native `typst` runs get them through `--package-path` (no network).

In `packages/edu`:
- Edit `typst/*.typ`, `css/edu.css` or `examples/*.typ`, then `pnpm embed` to regenerate `src/assets.generated.ts` (the files, CSS, the prompt catalogue from the `///` doc comments of the names `lib.typ` imports, and the examples; a test checks it). Every public function needs a doc comment with an `example` block.
- Answers must produce no output unless `sys.inputs.showAnswers` is `"true"`; every parameter needs a default and must accept what a stream cut leaves (`(2` is the number 2, `5em` arrives as `5`). Its tests compile with engine-wasm and native `typst`, so they run in CI's `Engine (wasm, html-compat, edu)` job; the compile oracle streams `examples/`.

In `packages/dom`:
- `pnpm test`: node tests (the HTML block splitter, paged helpers). `pnpm test:browser`: the renderers in Chromium, Firefox and WebKit, fed by the real engine worker with html-compat and corpus documents (needs engine-wasm's `dist/`). `BROWSERS=chromium` runs one.
- `pnpm size`: HTML renderer ≤ 9.5 KB gzipped (with its CSS), paged renderer ≤ 4 KB, standalone HTML export ≤ 2 KB.
- Its API report needs DOM types, so its `api-extractor.json` overrides the shared compiler settings.

In `packages/react`:
- `pnpm test`: Node tests (provider merging, the shared engine's lifetime). `pnpm test:browser`: `<Typstream>` with React Testing Library against the real engine worker in Chromium, Firefox and WebKit (StrictMode, lazy opening, worker cleanup). `BROWSERS=chromium` runs one. Needs engine-wasm's `dist/`.
- `pnpm size`: ≤ 16.5 KB gzipped including `@typstream/dom` (React and the engine external).
- Its bundle starts with `"use client"` (tsup banner), as does `typstream`'s, for Next.js's App Router.

In `examples/strict-csp`: `pnpm test` builds the page, serves it with the policy in `csp.mjs` and fails on any CSP violation or console error in Chromium, Firefox and WebKit (`BROWSERS=` picks some). Build the packages first (`pnpm turbo run build --filter=@typstream/example-strict-csp^...`). CI runs it in each browser's `Engine (<browser>)` job. Hostile documents go in `corpus/adversarial/hostile-*.typ` (category `hostile-…`); the engine's and the browser suites' `security.test.ts` run them all.

In `examples/nextjs-ai-sdk`: `pnpm test` builds the app (Turbopack) and streams one answer into `<Typstream>` in Chromium, failing on any error frame. Without `ANTHROPIC_API_KEY` the route replays a recorded worksheet; build the packages first (`pnpm turbo run build --filter=typstream...`). CI runs it in the `Engine (chromium)` job.

In `packages/heal`:
- `pnpm test:long`: 20,000-run property campaign (minutes).
- `pnpm bench`: vitest benchmarks.
- `node scripts/perf.mjs`: asserts the latency budgets; run `pnpm build` first. `PERF_TOLERANCE=3` (what CI uses) fails only above 3× budget.
- `pnpm size`: bundle budget, 15.5 KB gzipped.
- `pnpm mutate`: Stryker mutation testing of `src/` (~1.5–2 h on 6 cores). `STRYKER_INCREMENTAL=1` retests only what changed since the last run, but it reuses static mutants' (module-level constants) results whatever changed, so record scores from full runs. It fails below an 80% score; the first full run scored 80.59% (2026-10-26). It runs the suite without the corpus tests and with few, seeded property runs (`vitest.mutation.config.ts`, the `mutate` script's env). `node scripts/mutation-report.mjs --survivors` lists what survived. Equivalent mutants and known survivors are triaged on #6.

LLM corpus (`tools/llm-corpus`, README there): `node src/record.mjs --variant kit --label <name>` streams the 29 requests
from Haiku and Sonnet (needs an Anthropic key; ~$0.85 a run), `node src/measure.mjs <label>...` reports final-mode error
rates and classes, `node src/promote.mjs <label>` copies recordings into `corpus/llm`, then `pnpm corpus:validate llm/
--write-pages` (restore the other sets' `meta.json`, which it reformats, or `pnpm fix`). Change the prompt kit's rules
(`packages/edu/src/prompt.ts`, `eduPromptRules`) only with a new measured run under a new label. `corpus/llm` is opt-in
(`loadCorpus({ sets: ALL_SETS })`): its documents name the plugins they compile with (`meta.plugins`).

Compile oracle (`tools/compile-oracle`, needs the built engine): `pnpm turbo run test --filter=@typstream/compile-oracle`; `pnpm --filter @typstream/compile-oracle report` for the full measurement (minutes).

CI (`.github/workflows/ci.yml`) runs the same commands on every PR, building the oracle through `.github/actions/oracle` and engine-wasm through `.github/actions/engine-wasm` (both cached on the crate's inputs) and installing through `.github/actions/pnpm` (the store cached once per lockfile), plus the browser tests and the visual suite, one job per browser, inside Playwright's Docker image (`node tools/repo/playwright-docker.mjs <command>`; no `playwright install --with-deps`, whose Ubuntu mirror has stalled jobs for 10+ minutes). **A PR's CI should finish in about 5 minutes**: split a job that outgrows that across parallel jobs (heal's every-prefix corpus suite is four test files, `corpus-prefixes-<n>.test.ts`, so vitest runs them on separate workers), and move what can't be split to `nightly.yml`. Nightly runs `test:long`, heal's `pnpm mutate` (score in the job summary, HTML report as an artifact) and the corpus-wide browser suites; `gh workflow run nightly.yml --ref <branch> -f only=browser-suites` (or `heal-properties`, `heal-mutation`) runs one group on a branch. The repository's caches share 10 GB, evicted least recently used first: caches are saved from `main` only (PRs read them) and keyed so a run that changes nothing saves nothing.

Adding a package: copy `packages/core` and rename. Its `tsconfig.json`, `tsup.config.ts` and `api-extractor.json` only extend the shared configs (`tsconfig.base.json`, `tools/repo/`), and `@typstream/*` resolves to `packages/*/src` through a wildcard path. Then add its row to `tools/repo/layers.mjs`, and add it to the `fixed` group in `.changeset/config.json` if the row says `fixed`. Delete the copied `api/core.api.md` but keep `api/` (api-extractor won't create it), then `pnpm api:update` writes the new package's report.

In `tools/browser-suites` (PLAN.md §11.4, #19; details in its README):
- `pnpm test:browser`: equivalence (every corpus document streamed vs one-shot, both targets, artifacts and DOM), flicker
  (replays with MutationObservers: settled HTML blocks and pages stay) and accessibility (axe-core, both targets, light and
  dark) through `mountTypstream` on the real worker, in Chromium, Firefox and WebKit. `BROWSERS=chromium` runs one. Needs
  engine-wasm's `dist/`. The adversarial set's equivalence runs in Chromium only (engine and watchdog, ~10 min); the
  other browsers take ~5–8 min (WebKit ~45 min on CI). Too slow for PRs: the nightly workflow runs one job per browser.
- `pnpm test:visual`: screenshots against `__tests__/__screenshots__/<browser>/`, run inside Playwright's Docker image
  (`scripts/visual.mjs`; needs Docker) so baselines don't depend on the machine. `pnpm visual:update` accepts changes;
  commit the PNGs it writes (stored as palette PNGs). Engine, renderer, html-compat or CSS changes that alter output need
  it, as does a `playwright` upgrade (new image).

In `apps/website` (PLAN.md §10.5, #32, #33):
- `pnpm --filter @typstream/website dev` (http://localhost:3000), `build`, `test` (scripts/check-docs.mjs: titles,
  descriptions, `meta.json` navigation, and every `/docs/…` link and `#anchor`), `check-types`. Needs the packages built
  (turbo's `^build`) and engine-wasm's `dist/` for the live examples.
- Pages are `content/docs/**/*.mdx`, listed in each folder's `meta.json`. `title` and `description` are required: the
  description is the page's summary in llms.txt. Write Typst fences as ```typst (Shiki has no `typ` alias).
- **Agent-readable docs**: `/llms.txt` (an index linking every page's Markdown), `/llms-full.txt`, and every page as
  Markdown at `/docs/<page>.md` or with `Accept: text/markdown` (`proxy.ts`). The Markdown is the processed MDX
  (`source.config.ts`): `<HealPlayground>` is dropped, `<TypstPreview>` keeps only its code block. Set `SITE_URL` in
  deployments so llms.txt links are absolute.
- **Generated reference**: `<auto-type-table path="packages/…/src/file.ts" name="Type" />` (path from the repo root, the
  file that declares the type) renders the type's TSDoc, as a Markdown table in the `.md` version too.
  `scripts/generate.mjs` writes `content/docs/reference/edu/vocabulary.mdx` (gitignored) from edu's `eduCatalogue`
  before `dev`/`build`; a new edu function must be added to its `GROUPS`.
- **Live examples** render through the real engine: `<TypstPreview edu answers target="paged">` around a ```typst block,
  and the landing page replays `corpus/llm` recordings (`kit-v4-sonnet-*`) into `<Typstream>`. So a docs example that
  stops compiling shows on the page.

In `apps/playground` (PLAN.md §10.5, #31):
- `pnpm --filter playground dev`: Vite dev server on http://localhost:5173. `@typstream/*` resolves to `packages/*/src` (see `vite.config.ts`), so heal and engine edits hot-reload. The exception is engine-wasm: build its `dist/` once (`pnpm --filter @typstream/engine-wasm build`) before rendering works.
- Load a corpus entry, paste a document or `.stream.jsonl`, or open one from disk. Scrub by chunk, token or character (arrows, Shift for 10, Home/End, Space plays at the recorded timing). The panes show raw input vs healed source with patches, open frames, the settled boundary, lint findings and syntax errors; the inspector has per-step and whole-stream push timings against the §1 budget.
- The URL hash holds the whole state (source, seed, split, step, options), so a link reproduces a case. "Save as corpus case" downloads `.typ` + `.stream.jsonl` and shows the `meta.json` entry to add.
- The dev and preview servers send COOP/COEP headers: without cross-origin isolation browsers round `performance.now()` to 0.1 ms, too coarse for heal's timings. The first profile after a load includes JIT warm-up; use "re-run".
- The render pane spawns the real engine worker (`engineWorker()`, one per page) on first use. Its default mode, **`<Typstream>`**, is `@typstream/react`'s component as an app uses it: fed the raw input of each step with `isStreaming` until final mode, on its own document, with word fade-in and the caret; its status line reports what it rendered (blocks or pages, ms). The **Raw engine** mode `set()`s the healed source of each step into another document and shows the last good artifact exactly as the engine sent it, with no `@typstream/dom` in between: HTML in a sandboxed iframe (scripts off), pages as SVG `<img>`s, or the raw markup. The **DOM renderer** mode shows that same document through `@typstream/dom` (`createHtmlRenderer`, `createPagedView`), so switching between the three tells a bindings bug from a renderer bug from engine output. The engine's scheduler paces compiles, so playback doesn't flood it. Toggles: target (HTML / paged), html-compat (its preamble and files on the document, its CSS on the HTML and the renderer's sanitizer allowances), mode (`Off` spawns no worker). The inspector adds the shown document's status and fallback, worker-side compile timings, engine diagnostics and engine events; with `<Typstream>` its re-heal row checks that the component's own healing equals the healed pane. `render` (`engine`, `dom`, `off`; default `<Typstream>`), `target` and `compat` are in the URL hash.
- `pnpm --filter playground build` (static `dist/`), `test`, `check-types`.

Spikes (reference only):
- Custom engine: `spikes/phase0/custom-engine/build.sh <variant>`.
- Browser harness: `cd spikes/phase0/harness && npm i && node build.mjs && node run.mjs [filters]`. It needs Playwright's Chromium, Firefox and WebKit.

## Conventions

- **Typst is pinned to 0.15.1** everywhere: oracle, engine crate, recognizer port. Upgrading is a deliberate task: update all three and re-run the long property tests.
- **Offsets in JS APIs are UTF-16 indices** (JS string indices). Rust/Typst spans are UTF-8 bytes; convert at the wasm boundary.
- TypeScript strict, ESM, `verbatimModuleSyntax`. Biome formats (line width 120). Match the surrounding code's comment density: explain *why*, cite parser.rs/lexer.rs functions when porting.
- **Test against real Typst, not expectations of it.** Heal's tests check outputs with the oracle (`__tests__/support/oracle.ts`): parse errors, the parse tree's token modes (`tokenModes`), and Typst's own lexer run alone (`lexTokens`; build.rs copies its source out of the pinned typst-syntax crate). Engine work should add a compile oracle the same way.
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
- Visual baselines made outside Docker (plain `vitest` in `tools/browser-suites`) differ from CI's in fonts and
  antialiasing: the `visual` project only exists when `scripts/visual.mjs` runs it in the container.
- Vite rewrites only `new URL("literal", import.meta.url)` to files outside a package's root (workers, fonts): a URL
  built from a variable base 404s in browser tests.
