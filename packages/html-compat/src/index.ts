// @typstream/html-compat: makes Typst 0.15.1's HTML export keep the content of the layout
// elements it would otherwise drop ("grid was ignored during HTML export"). The Typst side is
// a prelude of show rules (typst/html-compat.typ); the browser side is a stylesheet for the
// HTML they emit (css/html-compat.css). Coverage matrix and decisions: PLAN.md §6.5.
import type { TypstreamPlugin } from "@typstream/core";
import { CSS_SOURCE, PRELUDE_SOURCE } from "./assets.generated";

/** Where the engine mounts the prelude in its virtual file system. */
export const HTML_COMPAT_PATH = "/@typstream/html-compat.typ";

/** The prelude's Typst source. Mount it at {@link HTML_COMPAT_PATH}. */
export const htmlCompatSource: string = PRELUDE_SOURCE;

/**
 * The stylesheet for the prelude's HTML and Typst-like defaults for tables and math. Its rules
 * are scoped to an element with class `typstream` (the renderer's root) and have zero
 * specificity (`:where`), so an app's own rules win.
 *
 * Math needs the "New Computer Modern Math" font (the engine's math font) registered as a web
 * font; without a math font browsers can't stretch delimiters.
 */
export const htmlCompatCss: string = CSS_SOURCE;

/**
 * Typst to put before a document: imports the prelude and applies it. It also replaces
 * `layout`, which HTML export would drop, with one that reports a fixed text width in HTML.
 * The rules act only on the HTML target, so the same preamble is safe for paged output.
 */
export const htmlCompatPreamble: string = `#import "${HTML_COMPAT_PATH}": html-compat, layout\n#show: html-compat\n`;

/**
 * Warnings the prelude can't prevent, as message substrings. A `#set page(...)` rule has no
 * HTML equivalent (no pages); its header, footer and page numbers aren't in the HTML output.
 */
export const KNOWN_HTML_WARNINGS: readonly string[] = ["page set rule was ignored during HTML export"];

/**
 * html-compat as a typstream plugin: the prelude file, the preamble, what the sanitizer must let
 * through, and the stylesheet.
 */
export const htmlCompat: TypstreamPlugin = {
  key: "html-compat",
  engine: {
    files: { [HTML_COMPAT_PATH]: PRELUDE_SOURCE },
    preamble: htmlCompatPreamble,
  },
  sanitize: {
    allowTags: ["div", "span", "svg"],
    allowAttrs: {
      div: ["class", "style", "role", "aria-label"],
      span: ["class", "style", "role", "aria-label"],
      ol: ["class"],
    },
  },
  stylesheets: [CSS_SOURCE],
};
