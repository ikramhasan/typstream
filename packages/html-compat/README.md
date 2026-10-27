# @typstream/html-compat

Typst 0.15.1's HTML export drops layout elements it can't express, and the text inside them: `#grid[…]`, `#align(center)[…]`, `#rect[…]`, `#place(…)`, `#stack`, `#columns`, `#pad`, the transforms and `layout` all come out empty ("grid was ignored during HTML export"). This package is a Typst prelude that maps each one to HTML (or, for drawings, an inline SVG), plus the CSS for that HTML.

```ts
import { HTML_COMPAT_PATH, htmlCompatCss, htmlCompatPreamble, htmlCompatSource } from "@typstream/html-compat";

engine.set_source(HTML_COMPAT_PATH, htmlCompatSource); // mount the prelude
engine.set_source("/main.typ", htmlCompatPreamble + document); // diagnostics: shift spans by the preamble's length
const { html } = engine.compile_html();
// In the page: <style>{htmlCompatCss}</style> and the output inside <div class="typstream">.
```

`htmlCompat` is the same as a `TypstreamPlugin` (files, preamble, sanitizer allowances). The preamble imports the prelude, applies it with `#show: html-compat`, and replaces `layout` with one that works in HTML. The rules act only when `target()` is `"html"`, so the same preamble leaves paged output byte-identical (tested).

## What it does

| Element | HTML |
|---|---|
| `grid` | CSS grid (`div.ts-grid`). Cells are placed like Typst places them (spans, explicit `x`/`y`); fill, stroke, align and inset may be functions of `(x, y)`; `hline`/`vline` become cell borders. |
| `table` | Native `<table>`; each cell gets a `div.ts-cell` with its resolved fill, inset and alignment. `stroke: none` removes the borders. |
| `align` | `div.ts-align` with `text-align`; blocks inside move the same way. Vertical alignment is dropped. |
| `block`, `box` | `div.ts-block` / `span.ts-box` with width, height, fill, stroke, inset, radius, baseline. |
| `rect`, `square`, `circle`, `ellipse` | `div.ts-shape` with the same properties. |
| `stack`, `columns`, `colbreak`, `pad` | flexbox, CSS columns, `break-after: column`, padding. |
| `place` | Absolutely positioned against the nearest box, block or shape; `float: true` stays in flow. |
| `v`, `h` | Fixed-size gaps. Fractional spacing (`h(1fr)`) becomes a small gap. Weak spacing and spacing in math are left to Typst. |
| `pagebreak` | `div.ts-pagebreak`: a rule on screen, a page break in print. |
| `move`, `rotate`, `scale`, `skew` | CSS transforms. `hide` is `visibility: hidden`. `repeat` repeats its body, clipped to the box. |
| `line` | A border when horizontal; otherwise drawn. |
| `curve`, `polygon`, angled lines; boxes and blocks that hold them; boxes and blocks made only of `place`d pieces (diagrams, CeTZ canvases); equations with `cancel` | Inline SVG (`html.frame`) in a `.ts-frame` with `role="img"` and the text as `aria-label` (`aria-hidden` when it has no text). |
| Numbered block equations | `div.ts-equation` with the number. `overline` in math becomes an accent (MathML has no overline). |
| `enum` with a pattern (`"a)"`) | Explicit markers. |
| `layout(f)` | Calls `f` with a fixed size: `compat-size`, the text width of an A4 page. |

Inside a box (an inline element), the prelude writes `span.ts-b` instead of `div`: a `<div>` there would make the browser close the paragraph and move everything after it out.

## Known gaps

- **Page furniture.** `#set page(...)` has no HTML equivalent. Its header, footer, page numbers, margins and columns are not in the output, and Typst warns ("page set rule was ignored during HTML export", listed in `KNOWN_HTML_WARNINGS`). The outline has no page numbers either.
- **Text styling.** `text(size:, weight:, fill:, font:)` is not carried over (Typst's HTML export ignores it; a `show text` rule would run on every word). `strong`, `emph`, `underline`, `highlight`, `sub`/`super` and `smallcaps` are native.
- **Fractional spacing** (`h(1fr)`, `box(width: 1fr)`, `v(1fr)`) has no HTML equivalent and becomes a small fixed gap.
- **Vertical alignment** inside `align`, `box` and `block` is dropped. Grid cells keep it.
- **Drawn content** (`.ts-frame`) is SVG: its text is in `aria-label`, not selectable. A drawing without text is hidden from assistive technology (`aria-hidden`): there is nothing to read out.
- `enum(full: true)` with a pattern shows plain numbers; the `augment` line of a matrix is dropped by Typst's MathML export.
- **Table** strokes other than the default or `none`, and `table.hline`/`table.vline`, are not drawn.
- **fletcher 0.5.8** diagrams stay empty: its cetz 0.3.4 canvas calls `layout` inside `context`, within the package, where neither the prelude's `layout` nor its drawing detection reaches. CeTZ 0.5 canvases (cetz, cetz-plot, alchemist) become `.ts-frame` SVG and are in the matrix.

## Tests

The tests compile through `@typstream/engine-wasm` and compare with native `typst` 0.15.1 (paged text via pdf.js), so they need the engine built, `cargo` (for Typst's fonts) and `typst` on `PATH`. CI runs them in the `Engine (wasm)` job.

- `coverage.test.ts`: the coverage matrix (`__tests__/support/matrix.ts`). Every entry compiles with no "ignored during HTML export" warning, and its HTML holds every letter and digit of its paged text, except documented gaps. Entries marked `nativeDrops` are checked to lose something without the prelude. The HTML must not put a `<div>` inside a `<p>` or `<span>`.
- `corpus.test.ts`: every `corpus/edu` document, with each one's known gap (page numbers, headers, PDF text-layer artifacts) listed.
- `paged.test.ts`: every SVG page is byte-identical with and without the prelude.

Edit `typst/html-compat.typ` and `css/html-compat.css`, then `pnpm embed` (or `pnpm build`) to regenerate `src/assets.generated.ts`. A test fails when it's stale.
