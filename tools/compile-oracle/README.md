# Compile oracle

Do healed stream prefixes **compile**? Heal's own tests prove every healed prefix parses (Typst's parser is the oracle). This workspace checks the next step: it streams documents through `@typstream/heal`'s incremental healer and compiles every healed prefix with the real compiler, `@typstream/engine-wasm`, then classifies the errors. Failing prefixes then go through the engine server's Layer 3 fixers (`@typstream/engine/server`, #20), the way the worker compiles them, to measure the rate with fixers, and what those leave through its Layer 4 fallback (#21). It lives outside `packages/` because heal may not import the engine (PLAN.md §4.1).

Documents: the corpus documents whose complete source compiles for the target (`corpus/`, up to 20 KB and 50 pages; the cut-off response counts, since it heals to one), documents from heal's property-test generator that compile when complete, `@typstream/edu`'s prompt examples (#23), with edu's import arriving whole in the first chunk as the engine's preamble would, and the recorded model output in `corpus/llm` that compiles when complete (#24), streamed with the API's own chunks, with edu's preamble and the vendored Universe packages.

```bash
pnpm turbo run test --filter=@typstream/compile-oracle   # builds the engine first if needed
pnpm --filter @typstream/compile-oracle report           # the full #13 measurement, minutes
```

- `__tests__/compile-oracle.test.ts` compiles one in three stream prefixes (`COMPILE_ORACLE_SAMPLE=1` for all) to HTML. Every error the fixers leave must be in an allowed class (`ALLOWED`), each tied to what handles it; an allowed class that stops occurring must be removed. It prints the prefix compile rate (PLAN.md §1), with heal alone and with Layer 3, and fails when the latter is below `RATE_FLOOR`.
- `__tests__/report.test.ts` (`pnpm report`) compiles every stream prefix (`COMPILE_ORACLE_STEP=char`: every code point) for HTML and paged output, checks whether the settled part compiles on its own, and counts the fix rounds and their time. It prints Markdown tables and writes the classified prefixes as JSON to the temp directory (`COMPILE_ORACLE_OUT` to change).
- `__tests__/fallback.test.ts` checks Layer 4 (#21): every corpus document that doesn't run away renders in final mode (heal's final mode, then the server with block isolation), with at most ⌈log₂ n⌉ checks per isolated block, and documents with lasting errors keep rendering while they stream. The prefix runs above also compile what Layer 3 leaves with the fallback, asked for the stable prefix; `compile-oracle.test.ts` requires every prefix to render.
- `support/classify.ts` defines the error classes; `support/server.ts` runs the engine's protocol server over the oracle's engine.

Needs the built engine, Cargo (for Typst's bundled fonts from the `typst-assets` crate) and nothing else; CI runs it in the engine job.
