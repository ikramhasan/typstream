// @typstream/google-fonts: any family of the Google Fonts library, by name
// (PLAN §6.4). A font catalogue plugin: catalogue.json lists every family of
// github.com/google/fonts at one commit (scripts/catalogue.mjs writes it), with
// its TTF files, which jsDelivr serves from that commit. When a document names
// a family the engine doesn't have, the engine looks it up there, downloads it,
// and compiles again: Typst draws the paged target with it.
//
// Typst's HTML export drops fonts, so the preamble marks text whose font isn't
// the document's own with its family (`data-typstream-font`), and the renderer
// shows the families the engine loaded as web fonts made from the same files.

import type { FontCatalogue, TypstreamPlugin } from "@typstream/core";

/**
 * URL of the catalogue's index, next to this package's JS: bundlers emit it
 * as an asset. Fetched the first time a document names a family the engine
 * doesn't have (465 KB, 67 KB gzipped).
 * @public
 */
export const GOOGLE_FONTS_INDEX: string = new URL("../catalogue.json", import.meta.url).href;

/**
 * Typst before every document: in the HTML target, text in another font than
 * the document's own carries that font's family, which Typst's HTML export
 * would drop (`<span data-typstream-font="lora">`). Not in equations (MathML
 * keeps to its math font), nor in frames, which Typst draws itself.
 *
 * `text.costs.orphan` marks an equation's text, as html-compat marks math and
 * inline content with other costs: a value no document sets, and that only
 * line breaking, which frames alone do in HTML, reads.
 * @public
 */
export const googleFontsPreamble: string = `#show: body => context if target() == "html" {
  let base = text.font
  show math.equation: it => { set text(costs: (orphan: 100.0002%)); it }
  show text: it => context {
    if target() != "html" or text.font == base or text.costs.orphan == 100.0002% { return it }
    let family = if type(text.font) == array { text.font.first() } else { text.font }
    if type(family) == dictionary { family = family.name }
    html.elem("span", attrs: ("data-typstream-font": family), it)
  }
  body
} else { body }
`;

/** Options of {@link createGoogleFonts}. @public */
export interface GoogleFontsOptions {
  /**
   * The most a family may download, in bytes; larger ones (CJK families run to
   * 10–20 MB) aren't loaded. Default 5 MB.
   */
  maxBytes?: number;
  /**
   * URL of the index to use instead of the package's: a copy whose `base`
   * points at your own mirror of the font files, say.
   */
  index?: string;
}

/**
 * The Google Fonts library as a typstream plugin: the font catalogue
 * (`engine.fontCatalogues`), the preamble that keeps fonts in the HTML target,
 * the attribute the sanitizer must let through, and prompt rules. Families
 * download from cdn.jsdelivr.net when a document first names them, so a page
 * under a Content-Security-Policy must allow it in `connect-src`.
 * @public
 */
export const createGoogleFonts = (options: GoogleFontsOptions = {}): TypstreamPlugin => {
  const catalogue: FontCatalogue = {
    index: options.index ?? GOOGLE_FONTS_INDEX,
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
  };
  return {
    key: "google-fonts",
    engine: { fontCatalogues: [catalogue], preamble: googleFontsPreamble },
    sanitize: { allowAttrs: { span: ["data-typstream-font"] } },
    prompt: {
      rules: [
        'Fonts: any Google Fonts family, by its exact name: `#set text(font: "Lora")` for the whole document, `#show heading: set text(font: "Playfair Display")` for headings, `#text(font: "Caveat")[…]` for a passage. Each family is downloaded the first time it is used, so use one or two.',
        'Fonts that aren\'t in Google Fonts aren\'t available. Use "Arimo" for Arial or Helvetica, "Tinos" for Times New Roman, "Carlito" for Calibri, "Caladea" for Cambria, "Cousine" for Courier New, "Comic Neue" for Comic Sans MS.',
      ],
    },
  };
};

/**
 * {@link createGoogleFonts} with its defaults.
 *
 * @example
 * ```tsx
 * import { googleFonts } from "@typstream/google-fonts";
 *
 * <Typstream source={text} plugins={[googleFonts]} />
 * ```
 * @public
 */
export const googleFonts: TypstreamPlugin = createGoogleFonts();
