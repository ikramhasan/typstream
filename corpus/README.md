# corpus

Typst documents shared by every layer's tests (PLAN.md §11.2): heal's prefix
properties today, and engine, renderer and visual tests as they land. The
package `@typstream/corpus` (private) loads entries and replays them as streams.

## Layout

```
corpus/
  <set>/<name>.typ            the document
  <set>/<name>.stream.jsonl   optional: the stream it arrived as
  <set>/meta.json             one entry per document, keyed by name
  <set>/assets/               files documents read (bibliographies, ...)
```

Sets:

- **`edu/`**: hand-written education documents: worksheets, multiple-choice and
  true/false quizzes, exams with answer keys, lesson plans, rubrics, reading
  comprehension, math- and table-heavy documents, a report with an outline and
  bibliography, and Bengali, Arabic (RTL), Chinese, Hindi, Spanish and French
  documents. All compile with native Typst 0.15.1.
- **`adversarial/`**: hostile and extreme inputs: 10k-deep nesting, a 1 MB
  document, a 2,000-row table, a 200 KB single line, 500 pages, every Markdown
  habit, a truncated response, runaway loops and recursion, memory bombs, zalgo
  text, mixed-direction text and backtick runs. The big ones come from
  `scripts/generate-adversarial.mjs`, which is deterministic. Re-run it after
  editing it. The `hostile-*` documents attack the sandbox and the page (#29,
  `docs/security.md`): reads, images, imports, plugins and XML outside the
  virtual file system; `javascript:` and `data:` links; `html.elem` scripts,
  handlers, frames, forms and CSS; markup in text; a runaway wasm plugin;
  content nested too deep for the stack; huge dimensions. Their categories start
  with `hostile-`; the engine's and the browser suites' security tests run them all.

The LLM-generated set (recorded streams from real models) is #24.

### `meta.json`

```jsonc
{
  "worksheet-fractions": {
    "category": "worksheet",          // document kind, or the adversarial class
    "expect": "ok",                   // ok (default) | error | limit
    "expectedPages": 1,               // required when expect is ok
    "allowedWarnings": ["..."],       // substrings; any other warning fails validation
    "expectedErrors": ["..."],        // required when expect is error
    "tags": ["math", "columns"],
    "stream": { "source": "synthetic", "options": { "seed": 7 } }, // when a .stream.jsonl exists
    "notes": "..."
  }
}
```

`expect` describes native `typst compile`:

- `ok`: compiles; the page count matches; every warning matches `allowedWarnings`, and each allowed warning occurs.
- `error`: fails, and each `expectedErrors` string appears in the diagnostics.
- `limit`: must not finish within 10 s and 2 GiB (runaway code, memory bombs), or dies trying (a stack overflow). The engine's watchdog, or its handling of a worker that traps, has to stop these.

### `.stream.jsonl`

One chunk per line: `{"t": 120, "text": "#set page("}`. `t` is the arrival time
in ms from the first chunk, and is non-decreasing. Joining every `text` gives
exactly the `.typ` source. Entries without a stream file get a synthetic one on
demand (`streamOf(entry)`).

## API

```ts
import { loadCorpus, replay, streamOf, synthesizeStream } from "@typstream/corpus";

for (const entry of loadCorpus({ sets: ["edu"] })) {
  await replay(streamOf(entry), (chunk) => healer.push(chunk.text)); // as fast as possible
  await replay(streamOf(entry), onChunk, { speed: 1 });              // in real time
}
```

`synthesizeStream(source, { seed, tokensPerSecond, maxTokensPerChunk })` cuts a
source into token-sized chunks (BPE-shaped: words up to 6 letters, digit runs,
1–2 symbols, whitespace). It sends 1–3 tokens per chunk at about 60 tokens/s,
with jitter and occasional stalls. It is deterministic per seed and never
splits a code point.

## Commands

```bash
pnpm corpus:validate                  # from the repo root: native typst compile of every entry
pnpm corpus:validate edu/quiz         # only ids containing a filter
pnpm --filter @typstream/corpus test  # format and replay tests (no typst needed)
pnpm --filter @typstream/corpus generate                       # regenerate the big adversarial files
pnpm --filter @typstream/corpus build && \
  pnpm --filter @typstream/corpus stream edu/<name>.typ --seed 7  # write a synthetic .stream.jsonl
```

`corpus:validate` needs **`typst` 0.15.1** on `PATH`, or `TYPST=/path/to/typst`.
It compiles with `--ignore-system-fonts`, so results don't depend on installed
fonts, and with `--features html`, so documents may use `html.elem` (paged
output ignores it, with a warning). Bengali, Devanagari and CJK text renders as missing glyphs without a
warning, which is fine for validation (fonts are #11). `limit` entries run under
`prlimit` (util-linux) and are skipped where it's missing (macOS).
`--write-pages` records the page counts of `ok` entries in `meta.json`. It and
the `stream` script rewrite `meta.json`, so run `pnpm fix` afterwards.

### In CI

The `corpus` job in `.github/workflows/ci.yml` installs Typst 0.15.1 from the
release tarball and runs `pnpm corpus:validate`. Note that the validator reads
`TYPST` as the path to a binary, not a version.

It needs no build and no oracle. On a 6-core machine it takes 10–30 s, mostly
the 1 MB document, the 200 KB line and the 10 s `limit` timeouts. Heal's corpus
tests run as part of `pnpm test` and only need the syntax oracle.
