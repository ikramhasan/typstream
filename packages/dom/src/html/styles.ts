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
 * layout is as before. What reaches past the element (a table wider than it)
 * scrolls sideways instead: the renderer marks it once laid out (#95), and
 * vertically it overflows by box edges only (taller glyph boxes in equations).
 * A display equation is as wide as its content (Firefox's and WebKit's are
 * otherwise as wide as their container, with the content overflowing them).
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
:where(.typstream [data-typstream-wide]) {
  overflow: auto hidden;
}
:where(.typstream math[display=block]) {
  min-width: max-content;
}
:where(.typstream typstream-island) {
  display: block;
  position: relative;
}
:where(.typstream typstream-island > svg) {
  max-width: 100% !important;
  height: auto !important;
  margin-inline: auto;
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
