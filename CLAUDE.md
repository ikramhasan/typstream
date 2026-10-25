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
tools/typst-syntax-oracle   Typst's real parser compiled to wasm for Node; the ground truth in heal's tests.
spikes/phase0     Throwaway Phase 0 experiments: browser harness (harness/) and custom Typst wasm engine (custom-engine/).
                  Port code out of here into packages/; don't import from spikes.
PLAN.md           Design and roadmap.
```

Planned packages and their dependency layers are in PLAN.md §4.1. Rules: `core` has no dependencies; nothing below the bindings layer imports React; protocol and plugin types live in `core`.

## Setup and commands

Toolchain:
- Node ≥ 20 (developed on 25).
- pnpm 12.
- For the oracle and engine: Rust ≥ 1.92 (Typst 0.15.1 needs it), the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` at **exactly** the `wasm-bindgen` version in the crate's `Cargo.lock` (currently 0.2.129).
- `binaryen` (`wasm-opt`) for the engine.

```bash
pnpm install
pnpm oracle            # build tools/typst-syntax-oracle (needed before heal's tests run)
pnpm build             # turbo: all packages
pnpm test              # turbo: all packages
pnpm check-types
pnpm check             # Biome lint + format check (pnpm fix to apply)
```

In `packages/heal`:
- `pnpm test:long`: 20,000-run property campaign (minutes).
- `pnpm bench`: vitest benchmarks.
- `node scripts/perf.mjs`: asserts the latency budgets; run `pnpm build` first.
- `pnpm size`: bundle budget, 15 KB gzipped.

Spikes (reference only):
- Custom engine: `spikes/phase0/custom-engine/build.sh <variant>`.
- Browser harness: `cd spikes/phase0/harness && npm i && node build.mjs && node run.mjs [filters]`. It needs Playwright's Chromium, Firefox and WebKit.

## Conventions

- **Typst is pinned to 0.15.1** everywhere: oracle, engine crate, recognizer port. Upgrading is a deliberate task: update all three and re-run the long property tests.
- **Offsets in JS APIs are UTF-16 indices** (JS string indices). Rust/Typst spans are UTF-8 bytes; convert at the wasm boundary.
- TypeScript strict, ESM, `verbatimModuleSyntax`. Biome formats (line width 120). Match the surrounding code's comment density: explain *why*, cite parser.rs/lexer.rs functions when porting.
- **Test against real Typst, not expectations of it.** Heal's tests check outputs with the oracle (`__tests__/support/oracle.ts`). Engine work should add a compile oracle the same way.
- Property tests build documents from **complete** constructs (`__tests__/support/generators.ts`) and derive truncation from the streaming cut. Every bug fix adds a row to `constructs.test.ts` or a case to the generators.
- Healing invariants must keep holding (PLAN.md §5.4): healed prefixes parse; settled text is untouched; healing is idempotent; valid documents come back unchanged; incremental, chunked and edited results equal stateless healing.
- Performance budgets in PLAN.md §1 and §11.5–11.6 are enforced by scripts. Don't regress them silently.

## Gotchas

- **The file-writing tool may decode `\uXXXX` escapes in source into literal (often invisible) characters** (U+2028, U+200B, combining marks). Write such escapes from a script, or scan afterwards: categories Zl, Zp, Cf, Mn, Cs, Cc in `.ts` files should be zero.
- pnpm 12 blocks install scripts unless listed in `allowBuilds` in `pnpm-workspace.yaml` (esbuild is).
- The oracle's `pkg/` needs a `{"type":"commonjs"}` `package.json` (its build script writes it), because the repo root is ESM.
- Typst's memoization cache grows with every compile unless the engine calls `comemo::evict(2)` **after every compile** (Phase 0: flat ~21 MB vs +2 MB/compile).
- Chrome DevTools CPU throttling doesn't slow Web Workers. Worker timings under CDP throttling aren't low-end numbers.
- typst-wasm (npm) only accepts relative paths (`main.typ`) and needs COOP/COEP or JSPI. typst.ts's `render_svg` panics on normal documents (use `render_svg_diff`). Details in `spikes/phase0/RESULTS.md`.
- The shell prints a zoxide warning on every command; set `_ZO_DOCTOR=0` to silence it.
