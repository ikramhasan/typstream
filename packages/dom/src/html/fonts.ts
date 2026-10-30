// Fonts for the HTML target, where the browser draws the text.
//
// MathML needs a math font: without one, browsers can't stretch delimiters or
// pick math italics (PLAN §6.5). html-compat's CSS asks for Typst's own,
// New Computer Modern Math, which the engine ships with its base fonts.
//
// Families the engine loads from font catalogues (PLAN §6.4) become web fonts
// made from the same files. Typst's HTML export drops `text(font: ..)`, so a
// catalogue's plugin marks the text instead (`data-typstream-font`, the family
// lowercased, as Typst compares it); a rule per loaded family shows it. Text in
// a family that isn't loaded keeps the page's font rather than the browser's
// default, which naming a family the browser lacks would give it.

import type { LoadedFontFamily } from "@typstream/core";
import { injectCss } from "./css";

/**
 * The line box of the engine's layout profile (#129), as a web font's metrics: 1.054em above the baseline, 0.246em
 * below, no gap. With `line-height: normal`, a line of text in any of these fonts is as tall as Typst's and has its
 * baseline where Typst's is.
 */
const PROFILE_METRICS = { ascentOverride: "105.4%", descentOverride: "24.6%", lineGapOverride: "0%" };

/** The web font a family is registered as: html-compat's name for it (`_family` in html-compat.typ). */
const familyName = (family: string): string => `typstream-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** A font file to show the HTML target's text in. @public */
export interface TypstFont {
  /** Where the file is. */
  url: string | URL;
  /** Its family, as Typst names it (`Libertinus Serif`). */
  family: string;
  /** Default 400. */
  weight?: number;
  /** Default `normal`. */
  style?: "normal" | "italic";
}

/** Fonts registered per document, by URL. */
const typstFonts = new WeakMap<Document, Set<string>>();

/**
 * Registers Typst's fonts as web fonts in `doc`, so the HTML target sets its text as the pages do: each under
 * html-compat's name for its family (`typstream-libertinus-serif`), with the layout profile's line box as its
 * metrics. The browser downloads a file the first time text needs it (the script fonts only for their scripts).
 * Pass the engine's (`typstream` does: `@typstream/engine-wasm/fonts`' base, extra and script fonts).
 * `mountTypstream` calls it with its `fonts`. Uses the FontFace API, so no `font-src` exception for inline CSS.
 * @public
 */
export const registerTypstFonts = (fonts: readonly TypstFont[], doc: Document = document): void => {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  if (!view) return;
  const done = typstFonts.get(doc) ?? new Set<string>();
  typstFonts.set(doc, done);
  for (const font of fonts) {
    const url = String(font.url);
    if (done.has(url)) continue;
    done.add(url);
    const face = new view.FontFace(familyName(font.family), `url(${JSON.stringify(url)})`, {
      weight: String(font.weight ?? 400),
      style: font.style ?? "normal",
      ...PROFILE_METRICS,
    });
    doc.fonts.add(face);
  }
};

/** The family html-compat's stylesheet uses for `math`. */
const MATH_FAMILY = "New Computer Modern Math";

/**
 * Registers New Computer Modern Math as a web font in `doc`, for MathML. Pass
 * the URL of the engine's copy (`@typstream/engine-wasm/fonts`) or your own.
 * Uses the FontFace API, so no `font-src` exception for inline CSS is needed.
 * @public
 */
export const registerMathFont = async (url: string | URL, doc: Document = document): Promise<void> => {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  if (!view) throw new Error("registerMathFont: the document has no window");
  for (const face of doc.fonts) if (face.family.replace(/"/g, "") === MATH_FAMILY) return;
  const face = new view.FontFace(MATH_FAMILY, `url(${JSON.stringify(String(url))})`);
  doc.fonts.add(face);
  await face.load();
};

/** The attribute text in a catalogue's family carries: the family, lowercased. */
export const FONT_ATTRIBUTE = "data-typstream-font";

/**
 * The web font a loaded family is registered as: prefixed, so the page's own
 * fonts of that name are left alone, and an identifier (`typstream-lora`,
 * `typstream-m-plus-1p`), which names the same face in CSS and in every
 * browser's FontFace API. Chrome's takes the family as written, so a quoted
 * name keeps its quotes and no CSS refers to it; Firefox's parses it as CSS,
 * where a name like "M PLUS 1p" needs them.
 */
export const webFontFamily = (font: LoadedFontFamily): string => familyName(font.family);

/** A file's `font-weight` descriptor: its weight, or a variable font's range. */
export const fontWeight = (file: LoadedFontFamily["files"][number]): string => String(file.weight).replace(",", " ");

/** The rule showing text marked with `font`'s family in its web font. */
export const loadedFontCss = (font: LoadedFontFamily): string =>
  `.typstream [${FONT_ATTRIBUTE}=${JSON.stringify(font.family)}] { font-family: ${webFontFamily(font)}; }\n`;

/** Families registered per document: their faces load once, whatever the number of documents showing them. */
const registered = new WeakMap<Document, Map<string, Promise<void>>>();

/**
 * Shows text the engine marked with a family it loaded from a font catalogue
 * (`Engine.fonts`, the `font` event) in that family, under `root`: registers
 * its files as web fonts in the root's document, then adds the rule for its
 * text to the root's document or shadow root. The files come from the HTTP
 * cache, where the worker's download put them. Uses the FontFace API with the
 * files' bytes: a strict Content-Security-Policy needs no `font-src` for it,
 * but the download needs `connect-src`, as the worker's does.
 * `mountTypstream` calls it for HTML documents.
 * @beta
 */
export const registerLoadedFont = async (font: LoadedFontFamily, root: Node): Promise<void> => {
  const doc = root.ownerDocument ?? (root as Document);
  const view = doc.defaultView as Window & typeof globalThis;
  const families = registered.get(doc) ?? new Map<string, Promise<void>>();
  registered.set(doc, families);
  let faces = families.get(font.family);
  if (!faces) {
    faces = Promise.all(
      font.files.map(async (file) => {
        const response = await view.fetch(file.url);
        if (!response.ok) throw new Error(`font ${file.url}: HTTP ${response.status}`);
        const face = new view.FontFace(webFontFamily(font), await response.arrayBuffer(), {
          style: file.style,
          weight: fontWeight(file),
          ...PROFILE_METRICS,
        });
        return face.load();
      }),
    ).then((loaded) => {
      for (const face of loaded) doc.fonts.add(face);
    });
    families.set(font.family, faces);
    // Tried again by the next call.
    faces.catch(() => families.delete(font.family));
  }
  await faces;
  injectCss(root, loadedFontCss(font));
};
