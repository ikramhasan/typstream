// A downloadable HTML file laid out as the pages (#118's look, PLAN §6.5): the HTML export shown by the HTML
// renderer out of sight, at the pages' own size, and its laid-out DOM written into the file with the renderer's CSS
// and the Typst fonts it used, embedded. The file runs no script (its policy forbids them), so the layout is done
// here, once: the file shows the pages as they were laid out, and prints them a page per sheet.
//
// The renderer has sanitized what it shows; the file still carries standaloneHtml's policy, so markup that the
// serializer and the reader's parser disagree about (mutation XSS) can't run anything either.

import { registerTypstFonts, type TypstFont, typstFontCss, usedTypstFonts } from "../html/fonts";
import { createHtmlRenderer } from "../html/renderer";
import { htmlRendererCss } from "../html/styles";
import { buildStandalone, type StandaloneHtmlOptions } from "./standalone";

/**
 * How {@link standalonePages} builds the file: {@link StandaloneHtmlOptions}, and Typst's fonts.
 * @public
 */
export interface StandalonePagesOptions extends StandaloneHtmlOptions {
  /**
   * Typst's fonts (`registerTypstFonts`; `typstream` passes the engine's): those the pages use are embedded in the
   * file, so it shows them where they aren't installed.
   */
  typstFonts?: readonly TypstFont[];
  /** The document to lay the pages out in. Default `document`. */
  document?: Document;
  /**
   * Called with the number of pages the export was laid out on: what `counter(page).final()` should be, through the
   * input `typstream-page-count` (`MountedTypstream.exportHtml()` compiles again with it).
   */
  onPages?: (count: number) => void;
}

/** The screen around the pages, and printing a page per sheet. */
const filePageCss = (width: number, height: number | null) => `:where(body.typstream-file) {
  margin: 0;
  padding: 16px;
  background: #e5e5e5;
  display: flex;
  justify-content: center;
}
:where(body.typstream-file .typstream-page) {
  box-shadow: 0 0 0 0.5px #bbb;
}
@media print {
  @page {
    size: ${width}pt ${height === null ? "auto" : `${height}pt`};
    margin: 0;
  }
  :where(body.typstream-file) {
    padding: 0;
    background: none;
    display: block;
  }
  :where(body.typstream-file .typstream-page) {
    box-shadow: none;
  }
}
`;

const frame = (view: Window) => new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));

const dataUrl = async (url: string, view: Window & typeof globalThis): Promise<string> => {
  const bytes = new Uint8Array(await (await view.fetch(url)).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${bytes[0] === 79 ? "font/otf" : "font/ttf"};base64,${view.btoa(binary)}`;
};

/**
 * Makes an HTML export (`EngineDocument.exportHtml({ anchors: true })`: html-compat writes the page settings on the
 * anchors) a file laid out as the pages, as the HTML renderer shows them: it lays the export out in `document`, out of sight and at the pages' size, and writes the result in the file
 * of {@link standaloneHtml} (its policy, plugins' stylesheets, title), with the renderer's CSS and the Typst fonts the
 * pages use, embedded. The file shows the pages one under the other and prints a page per sheet. Needs a browser.
 *
 * @example
 * ```ts
 * const file = await standalonePages(await doc.exportHtml({ anchors: true }), { plugins: doc.plugins, typstFonts });
 * ```
 * @public
 */
export const standalonePages = async (html: string, options: StandalonePagesOptions = {}): Promise<string> => {
  const doc = options.document ?? document;
  const view = doc.defaultView as Window & typeof globalThis;
  if (options.typstFonts) registerTypstFonts(options.typstFonts, doc);
  // As wide as its pages (their positions are the file's: from its left edge), and out of sight.
  const host = doc.createElement("div");
  host.style.cssText = "position:absolute;left:-200000px;top:0;width:max-content;visibility:hidden;pointer-events:none";
  host.setAttribute("aria-hidden", "true");
  const root = doc.createElement("div");
  host.append(root);
  doc.body.append(host);
  const renderer = createHtmlRenderer(root, {
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(options.stylesheets ? { stylesheets: options.stylesheets } : {}),
    layout: "fixed",
  });
  try {
    // The sheets touch: a page per sheet when printed, each where the layout put it.
    const sheets = root.querySelector<HTMLElement>(".typstream-paged");
    if (sheets) sheets.style.gap = "0";
    renderer.update(html);
    // Laid out in animation frames, again when fonts arrive.
    for (let i = 0; i < 3; i++) {
      await doc.fonts.ready;
      await frame(view);
      await frame(view);
    }
    options.onPages?.(root.querySelectorAll(".typstream-page").length);
    const copy = root.cloneNode(true) as HTMLElement;
    for (const el of copy.querySelectorAll(".typstream-underlay")) el.remove();
    const first = root.querySelector<HTMLElement>(".typstream-page");
    const [w, h] = (first?.style.aspectRatio ?? "").split("/").map((n) => Number.parseFloat(n));
    const fonts = await Promise.all(
      usedTypstFonts(doc).map(async (font) => typstFontCss(font, await dataUrl(String(font.url), view))),
    );
    const width = w ?? (first ? first.getBoundingClientRect().width * 0.75 : 595.276);
    return buildStandalone(html, options, {
      body: copy.outerHTML,
      css: [...fonts, htmlRendererCss, filePageCss(width, h ?? null)].join("\n"),
    });
  } finally {
    renderer.dispose();
    host.remove();
  }
};
