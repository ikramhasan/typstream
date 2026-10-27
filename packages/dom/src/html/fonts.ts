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
export const webFontFamily = (font: LoadedFontFamily): string =>
  `typstream-${font.family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

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
