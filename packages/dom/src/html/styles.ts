// The HTML renderer's stylesheet. Rules are scoped to the renderer's root
// (class `typstream`, the scope html-compat's CSS uses too) and wrapped in
// :where(), so an app's own rules win without !important.

import { THEME_CSS } from "./theme";

/**
 * Typst's MathML rules (typst-html 0.15.1, src/mathml.rs), which its export puts in <head>, scoped,
 * without its section comments (alignment, tables, equations, fractions, accents, then other rules
 * for scriptlevel, displaystyle and math-shift).
 */
export const TYPST_MATH_CSS = `:where(.typstream) mtable.right-align mtd,
:where(.typstream) mtable mtd.right-align,
:where(.typstream) mtable.left-align mtd.right-align,
:where(.typstream) mtable.aligned mtd:nth-child(odd) {
  justify-items: end;
  text-align: right;
}
:where(.typstream) mtable.cases mtd,
:where(.typstream) mtable.left-align mtd,
:where(.typstream) mtable mtd.left-align,
:where(.typstream) mtable.aligned mtd:nth-child(even),
:where(.typstream) math:is(:not([display])) > mtable.multiline-equation mtd {
  justify-items: start;
  text-align: left;
}
:where(.typstream) mtable.cases mtd,
:where(.typstream) mtable.aligned mtd,
:where(.typstream) mtable mtd.flushed,
:where(.typstream) mtable mtd.left-flush {
  padding-left: 0;
}
:where(.typstream) mtable.cases mtd,
:where(.typstream) mtable.aligned mtd,
:where(.typstream) mtable mtd.flushed,
:where(.typstream) mtable mtd.right-flush {
  padding-right: 0;
}
:where(.typstream) mtable {
  math-style: inherit;
}
:where(.typstream) mtd {
  math-depth: auto-add;
  math-style: compact;
  math-shift: compact;
}
:where(.typstream) mtable.multiline-equation mtd {
  math-depth: inherit;
  math-style: inherit;
  math-shift: inherit;
  padding: 0;
}
:where(.typstream) math > mtable.multiline-equation mtr:not(:last-child) mtd {
  padding-bottom: 0.5em;
}
:where(.typstream) mfrac {
  padding-inline: 0;
  margin-inline: 0.1em;
}
:where(.typstream) mover[accent="true" i] > :first-child {
  font-feature-settings: "dtls";
}
:where(.typstream) mover.dotted[accent="true" i] > :first-child {
  font-feature-settings: "dtls" 0;
}
:where(.typstream) munder > :nth-child(2),
:where(.typstream) munderover > :nth-child(2) {
  math-shift: compact
}
:where(.typstream) munder[accentunder="true" i] > :not(:first-child),
:where(.typstream) mover[accent="true" i] > :not(:first-child) {
  math-depth: inherit;
  math-style: inherit;
  math-shift: inherit;
}
`;

/**
 * The renderer's CSS: containment, theme variables, word fade-in, the caret,
 * and Typst's MathML rules. The renderer injects it unless told not to.
 *
 * Containment (#69): the document draws nothing and takes no clicks outside
 * its element, whatever its CSS or the page's (a page class that sets
 * `position: fixed`). `clip-path` clips every descendant, fixed ones included,
 * and hit testing with it; `overflow: clip` keeps what overflows from making
 * the page scroll, and `position: relative` (html-compat's too) puts absolute
 * boxes under it. None starts a formatting context (`contain: paint` and
 * `overflow: auto` would), so margins still collapse through the root and
 * layout is as before. On pages (`.typstream-pages`) the document is in its
 * flow, over the sheets, which clips the same way, its box the pages' text and
 * margins; the root doesn't, so the sheets' shadows show.
 *
 * Pages: the sheets are laid out from the page html-compat writes and scaled to
 * the element as the paged view's pages; the flow, as wide as a page, is
 * scaled with them and broken across them (pages.ts). Every element has no line
 * box of its own (`line-height: 0`) but text (`.typstream-t`), so a line is as
 * tall as its text, as Typst's, not at least a strut of its block's size.
 *
 * Word fade-in: durations and easing are set on the root, each word has its own
 * delay. `::marker` can't be wrapped and ignores opacity, so a list item's marker
 * fades its color with the item's first word.
 *
 * Comments stay out of the CSS strings: they would ship in every bundle.
 * @public
 */
export const htmlRendererCss: string = `${THEME_CSS}
:where(.typstream) {
  position: relative;
  overflow: clip;
  clip-path: inset(0);
}
:where(.typstream-pages) {
  color: #000;
  color-scheme: light;
  overflow: visible;
  clip-path: none;
}
:where(.typstream-pages > .typstream-paged) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
:where(.typstream-pages > .typstream-paged:is([data-layout=fit-width], [data-layout=reflow])) {
  align-items: stretch;
}
:where(.typstream-pages > .typstream-paged[data-layout=reflow]) {
  gap: 0;
}
:where(.typstream-pages .typstream-page) {
  position: relative;
  max-width: 100%;
  background: white;
}
:where(.typstream-pages *) {
  line-height: 0;
}
:where(.typstream-pages .typstream-t) {
  line-height: 1.3;
}
:where(.typstream-pages[data-baseline=round]) :is(.typstream-t, .ts-math) {
  --ts-x: calc(1.054em - round(1.054em, 1px) - (1.3em - round(1.054em, 1px) - round(0.246em, 1px)) / 2 + var(--ts-borrow, 0px));
}
:where(.typstream-pages[data-baseline=floor]) :is(.typstream-t, .ts-math) {
  --ts-x: calc(1.054em - round(1.054em, 1px) - round(down, (1.3em - round(1.054em, 1px) - round(0.246em, 1px)) / 2, 1px) + var(--ts-borrow, 0px));
}
/* A pixel the ascent gives the descent when the descent rounds down (Chrome on Linux): 1px then, else 0. */
:where(.typstream-pages[data-baseline-borrow]) :is(.typstream-t, .ts-math) {
  --ts-borrow: clamp(0px, (0.246em - round(0.246em, 1px)) * 100000, 1px);
}
:where(.typstream-pages[data-baseline] .typstream-t) {
  position: relative;
  top: var(--ts-x, 0px);
}
:where(.typstream-pages .ts-edges .typstream-t) {
  top: 0;
}
.typstream-pages[data-baseline] .ts-math svg {
  vertical-align: calc(var(--ts-depth, 0px) - var(--ts-x, 0px));
}
.typstream-pages[data-baseline] .ts-math.ts-flat svg {
  vertical-align: text-bottom;
  margin-block-end: calc(var(--ts-lift, 0px) - var(--ts-x, 0px) - 0.246em + round(0.246em, 1px) + var(--ts-borrow, 0px));
}
:where(.typstream .typstream-row) {
  display: flex;
  align-items: baseline;
}
:where(.typstream .typstream-seg:empty) {
  display: none;
}
:where(.typstream .typstream-fill) {
  display: block;
}
:where(.typstream .typstream-fill > .ts-hfill) {
  display: inline-block;
}
/* Glyph outlines the pictures use (renderer.ts): drawn only where they're used. */
.typstream .typstream-glyphs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
:where(.typstream-flow, .typstream-underlay) {
  position: absolute;
  box-sizing: border-box;
  transform-origin: 0 0;
  overflow: clip;
  clip-path: inset(0);
}
.typstream-pages .ts-place-text {
  text-box: none;
  padding-block: 0;
}
:where(.typstream-flow .ts-float-parent) {
  width: var(--typstream-text-width, auto);
}
:where(.typstream-flow .typstream-split) {
  background: none !important;
}
:where(.typstream-flow .typstream-split)::before {
  display: none !important;
}
:where(.typstream-underlay .typstream-piece) {
  position: absolute !important;
  box-sizing: border-box;
}
:where(.typstream-flow .typstream-endnotes) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
:where(.typstream-flow .typstream-island) {
  inset: 0 auto auto 0;
  width: calc(100% * var(--typstream-scale, 1));
  height: calc(100% * var(--typstream-scale, 1));
  transform: scale(calc(1 / var(--typstream-scale, 1)));
  transform-origin: 0 0;
  font-family: var(--typstream-host-font);
  font-size: var(--typstream-host-size);
  font-weight: 400;
  color: var(--typstream-host-color);
  text-align: start;
}
:where(.typstream-flow .typstream-island, .typstream-flow .typstream-island *) {
  line-height: var(--typstream-host-line, normal);
}
:where(.typstream-flow) > :first-child {
  margin-block-start: 0;
}
/* Below spacing (\`v\`) that starts a page, a block's spacing above goes too: Typst keeps weak spacing only after
   something laid out in the region (distribute.rs, keep_spacing). */
:where(.typstream-flow) > .ts-v:first-child + *,
:where(.typstream-flow .typstream-break) + .ts-v + * {
  margin-block-start: 0;
}
:where(.typstream typstream-island) {
  position: relative;
}
:where(.typstream typstream-island:has(> .typstream-island:not(:empty)) > svg) {
  visibility: hidden;
}
:where(.typstream .typstream-island) {
  position: absolute;
  inset: 0;
}
@media print {
  :where(.typstream .typstream-island) {
    display: none;
  }
  :where(.typstream typstream-island > svg) {
    visibility: visible;
  }
}
@keyframes typstream-fadeIn {
  from {
    opacity: 0;
  }
}
@keyframes typstream-blurIn {
  from {
    opacity: 0;
    filter: blur(4px);
  }
}
@keyframes typstream-slideUp {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@keyframes typstream-markerIn {
  from {
    color: transparent;
  }
}
:where(.typstream) [data-typstream-animate] {
  animation: var(--typstream-animation, typstream-fadeIn) var(--typstream-duration, 150ms)
    var(--typstream-easing, ease) var(--typstream-delay, 0ms) both;
}
:where(.typstream) [data-typstream-animate-marker]::marker {
  animation: typstream-markerIn var(--typstream-duration, 150ms) var(--typstream-easing, ease)
    var(--typstream-marker-delay, 0ms) both;
}
@keyframes typstream-caret {
  50% {
    opacity: 0;
  }
}
:where(.typstream) .typstream-caret::after {
  content: var(--typstream-caret, "\\258B");
  color: var(--typstream-caret-color);
  margin-inline-start: 0.1em;
  animation: typstream-caret 1s step-end infinite;
}
@media (prefers-reduced-motion: reduce) {
  :where(.typstream) [data-typstream-animate],
  :where(.typstream) [data-typstream-animate-marker]::marker,
  :where(.typstream) .typstream-caret::after {
    animation: none;
  }
}
${TYPST_MATH_CSS}`;
