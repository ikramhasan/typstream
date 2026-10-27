// A downloadable HTML file from an HTML export (PLAN §6.5, #18): Typst's HTML
// document plus the renderer's theme, the app's stylesheets (html-compat's) and
// a math font, so it looks like the preview when opened on its own.
//
// The HTML is LLM-written and isn't sanitized here: the renderer's sanitizer
// cleans nodes for a live page, and serializing them again for a file would
// invite mutation XSS. Instead a Content-Security-Policy comes first in
// <head>, so whatever the document contains can't run scripts, load anything
// from the network or submit forms. It's a string transform (Typst's
// serializer is regular, see ../html/split.ts), so it runs anywhere.

import { directionOf } from "../html/dir";
import { THEME_CSS } from "../html/theme";

/**
 * How {@link standaloneHtml} builds the file.
 * @public
 */
export interface StandaloneHtmlOptions {
  /** CSS added after the theme: html-compat's stylesheet, an app's own. */
  stylesheets?: readonly string[];
  /**
   * `light` (default: files get printed and shared), `dark`, or `auto`
   * (follows the reader's system).
   */
  theme?: "light" | "dark" | "auto";
  /**
   * New Computer Modern Math for MathML, which browsers need to stretch
   * delimiters (PLAN §6.5): the font file's bytes to embed (~0.7 MB as base64),
   * or an absolute URL to load it from. Without it, readers' browsers use their
   * own math font, if any.
   */
  mathFont?: Uint8Array | string | URL;
  /** The `<title>`, unless the document sets one (`#set document(title: …)`). */
  title?: string;
}

/** The family the theme and html-compat's CSS ask for on `math` (see ../html/fonts.ts). */
const MATH_FAMILY = "New Computer Modern Math";

/** Reading layout for a page of its own; printing uses the printer's margins. */
const PAGE_CSS = `:where(body.typstream) {
  max-width: 48rem;
  margin: 2rem auto;
  padding: 0 1rem;
  line-height: 1.5;
  background: light-dark(#fff, #121214);
}
@media print {
  :where(body.typstream) {
    max-width: none;
    margin: 0;
    padding: 0;
  }
}
:where(.typstream) math {
  font-family: "${MATH_FAMILY}", math;
}
`;

const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const base64 = (bytes: Uint8Array): string => {
  let binary = "";
  // In chunks: spreading a whole font into fromCharCode overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** A tag's attributes with `name` set to `value`, or with `value` added to it (`class`). */
const withAttr = (attrs: string, name: string, value: string, append = false): string => {
  const existing = new RegExp(`(\\s${name}=")([^"]*)(")`, "i");
  if (existing.test(attrs))
    return attrs.replace(existing, (_, a, v, z) => `${a}${append ? `${v} ${value}` : value}${z}`);
  return `${attrs} ${name}="${value}"`;
};

/**
 * Makes an HTML export (`EngineDocument.exportHtml()`) a file that opens on
 * its own: the renderer's theme and `stylesheets` inline, the root class
 * `typstream` on `<body>`, an optional math font, and a Content-Security-Policy
 * that keeps the document from running scripts or loading anything except
 * inline styles and `data:` images and fonts (plus `mathFont`'s origin when it
 * is a URL). `<meta http-equiv="refresh">` is removed, and an RTL document's
 * `<html>` gets `dir="rtl"` from its `lang` (Typst writes no direction).
 *
 * @example
 * ```ts
 * const file = standaloneHtml(await doc.exportHtml(), { stylesheets: [htmlCompatCss], mathFont });
 * const url = URL.createObjectURL(new Blob([file], { type: "text/html" }));
 * ```
 * @public
 */
export const standaloneHtml = (html: string, options: StandaloneHtmlOptions = {}): string => {
  const theme = options.theme ?? "light";
  const { mathFont } = options;
  let fontSrc = "data:";
  let fontFace = "";
  if (mathFont !== undefined) {
    let src: string;
    if (mathFont instanceof Uint8Array) {
      src = `data:font/otf;base64,${base64(mathFont)}`;
    } else {
      const url = new URL(String(mathFont));
      fontSrc += ` ${url.origin}`;
      src = url.href;
    }
    fontFace = `@font-face {\n  font-family: "${MATH_FAMILY}";\n  src: url(${JSON.stringify(src)});\n}\n`;
  }
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    `font-src ${fontSrc}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  // `</style` would end the element early wherever it appears in the CSS.
  const css = [fontFace, THEME_CSS, PAGE_CSS, ...(options.stylesheets ?? [])]
    .join("\n")
    .replace(/<\/(style)/gi, "<\\/$1");

  let head = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (theme === "auto") head += `\n<meta name="color-scheme" content="light dark">`;
  if (options.title !== undefined && !/<title[\s>]/i.test(html))
    head += `\n<title>${escapeText(options.title)}</title>`;

  let out = html.replace(/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh\b[^>]*>/gi, "");
  // Typst writes the language but no direction; without one an RTL document opens left to right.
  out = out.replace(/<html\b([^>]*)>/i, (tag, attrs: string) => {
    const lang = /\slang="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    return directionOf(lang) === "rtl" && !/\sdir=/i.test(attrs) ? `<html${withAttr(attrs, "dir", "rtl")}>` : tag;
  });
  // First in <head>, before anything the document put there.
  if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n${head}`);
  else if (/<html\b[^>]*>/i.test(out)) out = out.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n<head>\n${head}\n</head>`);
  else out = `<head>\n${head}\n</head>\n${out}`;
  out = out.replace(/<\/head>/i, `<style>\n${css}</style>\n</head>`);

  return out.replace(/<body\b([^>]*)>/i, (_, attrs: string) => {
    let a = withAttr(attrs, "class", "typstream", true);
    if (theme !== "auto") a = withAttr(a, "data-typstream-theme", theme);
    return `<body${a}>`;
  });
};
