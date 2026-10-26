# @typstream/edu

The Typst vocabulary typstream teaches the model for teachers' documents: worksheets, quizzes, exams, lesson plans and handouts (PLAN.md §8.3, [#23](https://github.com/ikramhasan/typstream/issues/23)). It's a Typst package plus the CSS for its HTML, packaged as a `TypstreamPlugin` with a prompt catalogue generated from the package's doc comments.

```ts
import { edu, eduCss } from "@typstream/edu";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";

<Typstream plugins={[htmlCompat, edu]} stylesheets={[htmlCompatCss, eduCss]} source={source} />;
// A teacher's copy: the same document with answers shown, recompiled, not re-prompted.
<Typstream plugins={[htmlCompat, edu]} inputs={{ showAnswers: "true" }} … />;
```

The plugin mounts the package's files (`eduFiles`) and adds a preamble (`eduPreamble`) that imports every public name, so documents call `#question` and friends directly:

```typ
#show: quiz.with(title: [Fractions], subject: [Mathematics], grade: [Grade 5])

#question(points: 2)[$1/2 + 1/4 =$ #blank(answer: $3/4$)]
#question(points: 1)[
  Which is largest?
  #mcq([$1/2$], [$2/3$], [$3/5$], answer: 2)
]
#question(points: 3)[
  Explain how you compare fractions.
  #answer-lines(count: 3, answer: [Rewrite them with a common denominator.])
]
#answer-key()
```

## Vocabulary

Every function works in the paged and the HTML target, and in English, Arabic and Bengali (labels, option letters, the points word; `dir="rtl"` on its HTML in Arabic). The full signatures, descriptions and examples are in `eduCatalogue`, generated from the `///` comments in `typst/`.

| Kind | Functions |
|---|---|
| Templates (`#show: x.with(…)`) | `worksheet`, `quiz` (adds the total points), `exam` (duration, total, instructions box, running header), `lesson-plan` (details table), `handout` |
| Questions | `question(points:)` (numbered through the document), `mcq(..options, answer:)`, `true-false(answer:)`, `matching(..pairs)` (give correct pairs; edu shuffles the right column and works out the key) |
| Answer spaces | `blank(width:, answer:)`, `answer-lines(count:, answer:)`, `answer-space(height:, boxed:, answer:)` |
| Answers | `answer[…]` (worked solutions), `answer-key()` |
| Teaching content | `callout(kind:)` (note, tip, warning, definition, example, remember), `instructions`, `learning-objectives`, `rubric(..criteria)`, `student-info(..fields)` |
| Drawings | `number-line`, `graph-paper`, `coordinate-plane` (native shapes; inline SVG with an `aria-label` in HTML) |
| Chemistry | `ce("2H2 + O2 -> 2H2O")`: an mhchem-like subset (subscripts, coefficients, charges, states, hydrates, arrows) written as math, so HTML gets MathML |

**Answers** appear only when `sys.inputs.showAnswers` is `"true"` (`SHOW_ANSWERS_INPUT`): written in place in red, the correct option circled, and listed by `answer-key()` under their question numbers. Otherwise they produce no output in either target, so a student's copy can't leak them (tested on PDF text and HTML).

**Streaming.** Every parameter has a default, and arrays and lengths cut mid-stream are accepted (`(2` heals to the number `2`, `5em` arrives as `5`), so a half-written call renders instead of failing the compile. The compile oracle streams the prompt examples at every code point: 100% of prefixes compile with the engine's Layer 3 fixers.

**Templates as `TemplateSpec`s** (`eduTemplates`, `mountTypstream`'s `template` option) apply a template for apps that ask the model for a body only. A document that writes its own `#show: worksheet.with(…)` (the prompt's default) must not get one too: it would apply twice.

## Using it with plain Typst

The package needs no typstream: copy `typst/` to `@typstream/edu/` in a project and import it.

```sh
mkdir -p project/@typstream && cp -r node_modules/@typstream/edu/typst project/@typstream/edu
typst compile --root project --input showAnswers=true project/main.typ   # main.typ starts with #import "/@typstream/edu/lib.typ": *
```

Once the engine resolves local `@typstream/*` packages (#25), edu will be mounted as `@typstream/edu:0.1.0` (its `typst.toml` is ready) and the preamble will import that. Documents don't change.

## Tests

The tests compile through `@typstream/engine-wasm` and native `typst` 0.15.1, so they need the engine built, `cargo` (for Typst's fonts) and `typst` on `PATH`. CI runs them in the `Engine (wasm)` job.

- `compile.test.ts`: every catalogue example, template and prompt example, plus empty and half-streamed calls, compile without errors or warnings in both targets, with answers hidden and shown, with and without html-compat.
- `answers.test.ts`: hidden answers are absent from PDF text and HTML; shown ones are in place and in the key; matching keys are right and nothing stays beside its match.
- `languages.test.ts`: labels, option letters and points in English, Arabic and Bengali; `dir="rtl"` in Arabic only.
- `chemistry.test.ts`: `ce()`'s MathML.
- `native.test.ts`: native `typst` compiles the examples and templates without warnings, to as many pages as engine-wasm.
- `package.test.ts`: the generated module is current and ASCII, the catalogue covers every public name, the CSS is scoped.
- `tools/compile-oracle`: the prompt examples' stream prefixes compile.

Edit `typst/`, `css/edu.css` or `examples/`, then `pnpm embed` (or `pnpm build`) to regenerate `src/assets.generated.ts`. A test fails when it's stale.
