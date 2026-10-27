# LLM corpus

Real model output for the prompt kit (#24, PLAN.md §8.3, §11.2): this workspace streams teachers' documents from Claude models with a given system prompt, records every text delta with its arrival time (the chunk boundaries production sees), measures whether the finished documents compile, and promotes recordings into `corpus/llm`.

```bash
pnpm turbo run build --filter=@typstream/llm-corpus^...   # edu, heal, universe, engine-wasm
cd tools/llm-corpus
ANTHROPIC_API_KEY=… node src/record.mjs --variant kit --label kit-v3   # 29 requests × 2 models
node src/measure.mjs naive kit-v3 --examples                          # Markdown summary
node src/promote.mjs kit-v3                                           # into corpus/llm
pnpm corpus:validate llm/ --write-pages && pnpm fix                   # from the root: page counts
```

- `src/requests.mjs`: the requests, one document each: the five templates and rubrics, math, chemistry, physics, diagrams, and Arabic and Bengali (some asked in those languages). They don't repeat edu's prompt examples.
- `src/variants.mjs`: the prompts. `naive` is the instructions `examples/nextjs-ai-sdk` had before it used the kit (plain Typst, no vocabulary). `kit` is `buildSystemPrompt([edu, universe])` as the code has it now, compiled with edu's preamble.
- `src/record.mjs`: writes `runs/<label>/system.md` (the exact prompt; a changed kit needs a new label), and per model and request `<id>.stream.jsonl` and `<id>.json` (stop reason, usage, timings). It resumes an interrupted run. API defaults otherwise: adaptive thinking, the model's default effort, `max_tokens` 16000. `ANTHROPIC_API_KEY_FILE` may name a file holding the key. The SDK also reads `ANTHROPIC_BASE_URL`; unset it if your shell points it at a proxy.
- `src/measure.mjs`: compiles each document as typstream does in **final mode**: heal's final mode (fences unwrapped, lint fixes, no tail repair), the run's preamble, the paged target with answers hidden and shown. A document fails on any error. Also reports the raw text's rate, HTML errors, error classes, heal's lint findings and the run's cost, and overflow: words in a table or grid cell wider than their column, which Typst lets run into the next column on paper (a probe measures every word against its cell, answers shown). It writes `runs/<label>/measure.json`.
- `src/promote.mjs`: copies recordings into `corpus/llm` as `<label>-<model>-<request>`, unchanged. A document that fails to compile becomes an `expect: "error"` entry naming its errors (engine-wasm's verdict; `corpus:validate` checks it natively).
- `src/engine.mjs`: engine-wasm in-process with Typst's bundled fonts, edu's files and `@typstream/universe`'s vendored packages. Nothing is fetched, so a package outside the allowlist fails as it does in the app.

`runs/` is gitignored working data. The corpus keeps what tests need. Recordings contain nothing personal: the requests are the ones above.

## Results (2026-10-27)

29 requests per run; Haiku was sampled more often because it costs 1/20 as much. Documents failing in final mode, with the model's raw rate in brackets where heal's `math-lone-script` (#24) changes it:

| prompt | claude-haiku-5-5 | claude-sonnet-5-5 |
|---|---|---|
| naive | 1/29 3.4% (raw 10.3%) | 3/29 10.3% |
| kit-v1: #23's rules | 2/29 6.9% (raw 13.8%) | 3/29 10.3% |
| kit-v2: Typst rules, packages must be imported | 4/58 6.9% (raw 8.6%) | 0/57 0% (raw 3.5%) |
| kit-v3: + words, blanks in math, CeTZ shapes | 2/58 3.4% (raw 5.2%) | 1/29 3.4% |
| kit-v4: + `mcq` math example, units in math | 4/116 3.4% (raw 6.9%) | **0/29 0%** |

Overflow (measured later, with the probe): none in the 405 kit-v1–v4 documents, whose tables are `#rubric` or `auto` columns; 2/58 in naive, both Haiku rubrics with fixed-width columns.

All 463 documents cost $5.36 (Sonnet $5.03, Haiku $0.32). The kit's prompt is ~8.4K tokens, cached across a run. Error classes and the reasoning behind each rule are on [#24](https://github.com/ikramhasan/typstream/issues/24).
