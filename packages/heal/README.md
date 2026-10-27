# @typstream/heal

Self-healing for streamed Typst. Give it any prefix of an LLM's Typst output and it returns a source that parses: it closes what's open, drops what can't be completed yet, and fixes common Markdown habits in text that has settled.

```ts
import { createHealer, heal } from "@typstream/heal";

heal("#table(columns: 2, [a], [b").source; // "#table(columns: 2, [a], [b])"
heal("Hello *bold").source; // "Hello *bold*"
heal("$x^").source; // "$x$"
heal("#let x = ").source; // ""  (an incomplete statement is dropped, not guessed)
heal("#set text(size: 12").source; // ""  (half-written global rules are never applied)

// Streaming: re-parses only from the last checkpoint before each change.
const healer = createHealer();
for await (const chunk of stream) {
  const { source, openFrames, stableOffset } = healer.push(chunk);
  compile(source); // always parses
}
const done = healer.finish(); // complete document: lint everything, report what's still broken
```

## How it works

1. **Normalize** the raw output. Strip a ```` ```typst ```` fence and a BOM, and hold back half a surrogate pair at the end.
2. **Recognize** the text with a faithful port of Typst 0.15.1's lexer and parser (`src/lexer.ts`, `src/recognizer.ts`). It records:
   - what the end of the text needs: `close` a delimiter, or `cut` an incomplete construct;
   - settled syntax errors;
   - root checkpoints to resume from after an edit.
3. **Repair the tail.** Cut, then close. Each candidate is re-recognized before it's accepted; a closer that would merge with the last token (`\` + `*`) gets a separator, or the token is dropped.
4. **Lint settled text**, meaning text before the stable offset, or everything in final mode. Rules: `markdown-heading`, `markdown-bold`, `markdown-link`, `email-at`, `bare-hash`, `stray-closer`, `unclosed-delim` and `math-lone-script` (`m/s$^2$` → `m/s$""^2$`) fix by default; `unclosed-block-comment` and `currency-dollar` warn by default.

Text before `stableOffset` never changes meaning as more text arrives, and the healer never rewrites it except for lint fixes.

## API

| | |
|---|---|
| `heal(input, options?)` | One-shot healing. |
| `createHealer(options?)` | Incremental healer. Methods: `push(chunk)`, `set(input)`, `applyEdit({from, to, insert})`, `setStreamingRange(range)` (an AI writing into the middle of a document), `finish()`, `reset()`. |
| `HealResult` | `source`, `stableOffset`, `map.toSource/toInput`, `patches`, `openFrames` (e.g. "writing a table…"), `findings`, `errors`. |
| Options | `final`, `dropIncompleteRules` (default `true`), `lint: { rule: "fix" \| "warn" \| "off" }`, `unwrapFences`, `streamingRange`, `handlers`. |
| `handlers` | `{ name, phase: "settled" \| "output", run(ctx) => TextChange[] }`. Product-specific fixes, e.g. expanding a `[[blank]]` shorthand. |
| `recognize(text)` | The recognizer on its own: requirements, errors, checkpoints. |

## Testing

`tools/typst-syntax-oracle` compiles Typst's real parser to wasm and is the ground truth. Build it once with `pnpm oracle` from the repo root; it needs Rust, the `wasm32-unknown-unknown` target and `wasm-bindgen-cli`.

- `pnpm test` runs the unit tests (constructs, lint, normalizer, healer API) and the property tests at 150 runs.
- Property tests check, for every prefix of generated documents:
  - the healed output parses;
  - only a bounded tail is lost and settled text is untouched;
  - healing is idempotent;
  - valid documents come back unchanged;
  - chunked streaming and random edits give the same result as stateless healing;
  - streamed regions leave the rest of the document intact.
- The recognizer itself is checked against Typst's parser on documents, all their prefixes and random character soup.
- `pnpm test:long` runs 20,000 property runs.
- `pnpm bench`: vitest benchmarks. `node scripts/perf.mjs` (after `pnpm build`) asserts the latency budgets.
- `pnpm size` checks the bundle budget (15.5 KB gzipped).
