// Wires a paged view to an engine document: renders each new paged artifact,
// asks for pages as drawings for its canvases (#14), and in the fit-width
// layout compiles pages as wide as the container (PLAN §6.5), through
// `sys.inputs` read by FIT_WIDTH_PREAMBLE.

import type { PagedArtifact } from "@typstream/core";
import type { EngineDocument } from "@typstream/engine";
import { createPagedView, type PagedView, type PagedViewOptions } from "./view";

/** `sys.inputs` keys the fit-width preamble reads. */
const WIDTH = "typstream-page-width";
const HEIGHT = "typstream-page-height";

/**
 * Typst for the document's preamble (`engine.open({ preamble })`) that sets the
 * page size from `sys.inputs` in the fit-width layout, and does nothing without
 * them. A document's own `#set page(width: …)` or `paper` comes later and wins:
 * Typst has no rule that applies after the document, so fit-width only sets the
 * default page.
 * @public
 */
export const FIT_WIDTH_PREAMBLE: string = `#set page(
  width: float(sys.inputs.at("${WIDTH}", default: "0")) * 1pt,
  height: if sys.inputs.at("${HEIGHT}", default: "auto") == "auto" { auto } else { float(sys.inputs.at("${HEIGHT}")) * 1pt },
) if "${WIDTH}" in sys.inputs`;

/** Options of {@link mountPaged}. @public */
export interface MountPagedOptions extends PagedViewOptions {
  /**
   * `canvas` (default): pages come as drawings and are painted on canvases, a
   * millisecond or two per streamed update where SVG pages take 12–31 ms (#14);
   * pages the engine can't draw (gradients, tilings, colour glyphs) still come
   * as SVG. `svg`: every page as SVG in the DOM, vector at any zoom.
   */
  renderer?: "canvas" | "svg";
  /**
   * Page height in the fit-width layout: `"a4"` (default) keeps A4's proportions
   * at the container's width, so long documents still have pages and only the
   * changed ones are sent; `"auto"` makes one page as tall as the content (every
   * update then redraws the whole document: for short ones).
   */
  pageHeight?: "a4" | "auto";
  /** The document's other `sys.inputs`; fit-width adds its own to them. */
  inputs?: Record<string, string>;
  /** Wait this long after the container's width last changed before recompiling (ms). Default 150. */
  resizeDebounce?: number;
}

/** A paged view mounted on a document. @public */
export interface MountedPaged {
  /** The view the document renders into. */
  readonly view: PagedView;
  /** Stops following the document and removes the view. */
  destroy(): void;
}

/** CSS px to points, rounded to half a point so subpixel resizes don't recompile. */
const toPt = (px: number) => Math.round(px * 1.5) / 2;

/**
 * The `sys.inputs` that make the fit-width preamble lay pages out `widthPx` CSS
 * pixels wide.
 * @public
 */
export const fitWidthInputs = (
  widthPx: number,
  pageHeight: "a4" | "auto" = "a4",
  inputs: Record<string, string> = {},
): Record<string, string> => {
  const width = toPt(widthPx);
  return {
    ...inputs,
    [WIDTH]: String(width),
    [HEIGHT]: pageHeight === "auto" ? "auto" : String(Math.round(width * Math.SQRT2 * 100) / 100),
  };
};

/**
 * Renders `doc` as pages in `container` and keeps them up to date. Switches the
 * document to the paged target. For `layout: "fit-width"`, open the document
 * with {@link FIT_WIDTH_PREAMBLE} in its preamble.
 * @public
 */
export const mountPaged = (
  container: HTMLElement,
  doc: EngineDocument,
  options: MountPagedOptions = {},
): MountedPaged => {
  const view = createPagedView(container, options);
  let shown: PagedArtifact | null = null;
  const show = () => {
    const { artifact } = doc.getState();
    if (artifact?.target !== "paged" || artifact === shown) return;
    shown = artifact;
    view.render(artifact);
  };
  const unsubscribe = doc.subscribe(show);

  let stopResize = () => {};
  if (options.layout === "fit-width") {
    const pageHeight = options.pageHeight ?? "a4";
    const fit = () => {
      const width = container.clientWidth;
      if (width > 0) doc.setInputs(fitWidthInputs(width, pageHeight, options.inputs));
    };
    // The first width compiles right away; later ones once resizing pauses.
    // Meanwhile the old pages scale to the new width.
    fit();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(fit, options.resizeDebounce ?? 150);
    });
    observer.observe(container);
    stopResize = () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }
  doc.setPageFormat(options.renderer === "svg" ? "svg" : "drawing");
  doc.setTarget("paged");
  show();

  return {
    view,
    destroy() {
      stopResize();
      unsubscribe();
      view.destroy();
    },
  };
};
