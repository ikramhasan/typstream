// The HTML renderer's stylesheet. Rules are scoped to the renderer's root
// (class `typstream`, the scope html-compat's CSS uses too) and wrapped in
// :where(), so an app's own rules win without !important.

import { THEME_CSS } from "./theme";

/** Typst's MathML rules (typst-html 0.15.1, src/mathml.rs), which its export puts in <head>, scoped. */
export const TYPST_MATH_CSS = `/* Alignment */
:where(.typstream) mtable.right-align mtd,
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
/* Tables */
:where(.typstream) mtable {
  math-style: inherit;
}
:where(.typstream) mtd {
  math-depth: auto-add;
  math-style: compact;
  math-shift: compact;
}
/* Equations */
:where(.typstream) mtable.multiline-equation mtd {
  math-depth: inherit;
  math-style: inherit;
  math-shift: inherit;
  padding: 0;
}
:where(.typstream) math > mtable.multiline-equation mtr:not(:last-child) mtd {
  padding-bottom: 0.5em;
}
/* Fractions */
:where(.typstream) mfrac {
  padding-inline: 0;
  margin-inline: 0.1em;
}
/* Accents */
:where(.typstream) mover[accent="true" i] > :first-child {
  font-feature-settings: "dtls";
}
:where(.typstream) mover.dotted[accent="true" i] > :first-child {
  font-feature-settings: "dtls" 0;
}
/* Other rules for scriptlevel, displaystyle and math-shift */
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
 * layout is as before; what reached past the element (a table wider than it)
 * is cut off.
 * @public
 */
export const htmlRendererCss: string = `${THEME_CSS}
/* Containment */
:where(.typstream) {
  position: relative;
  overflow: clip;
  clip-path: inset(0);
}

/* Word fade-in. Durations and easing are set on the root; each word has its own delay. */
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
/* ::marker can't be wrapped and ignores opacity, so it fades its color with the item's first word. */
:where(.typstream) [data-typstream-animate-marker]::marker {
  animation: typstream-markerIn var(--typstream-duration, 150ms) var(--typstream-easing, ease)
    var(--typstream-marker-delay, 0ms) both;
}
@media (prefers-reduced-motion: reduce) {
  :where(.typstream) [data-typstream-animate],
  :where(.typstream) [data-typstream-animate-marker]::marker {
    animation: none;
  }
}

/* The caret at the end of a streaming document. */
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
  :where(.typstream) .typstream-caret::after {
    animation: none;
  }
}

${TYPST_MATH_CSS}`;
