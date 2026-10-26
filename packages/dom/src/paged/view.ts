// The paged renderer (PLAN §6.5, #14): one element per page, kept in step with
// paged artifacts. Only pages whose hash changed are redrawn; visible ones at
// the next frame, the rest when the browser is idle (or when they scroll into
// view). Text layers are always built in idle time.
//
// Decisions measured in #14 (Chromium, Firefox, WebKit; 19 dense A4 pages):
// - Each page's SVG lives in its own shadow root. typst-svg repeats the glyph
//   <symbol>s a page uses under content-hash ids (`g…`), so inline pages share
//   ids. In Chromium, swapping one page then re-resolves every <use> in the
//   document: ~300 ms per streamed update at 19 pages, vs ~20 ms with ids
//   scoped per page. A shadow root scopes them without rewriting the markup, and
//   keeps the app's CSS off the SVG.
// - Glyph defs are not shared across pages. They are 29% of the bytes, but the
//   time goes to style and layout of the <use>s, which sharing doesn't remove.
// - Pages have `content-visibility: auto`, so the browser skips offscreen pages.

import type { PagedArtifact, PageUpdate } from "@typstream/core";
import { sanitizeLinks } from "./links";
import { type Cancel, idle } from "./schedule";
import { fillTextLayer, TEXT_LAYER_CSS } from "./text-layer";

/** Options of {@link createPagedView}. @public */
export interface PagedViewOptions {
  /**
   * `fixed` (default): pages at their authored size, scaled down to fit the
   * container. `fit-width`: pages fill the container's width (use it with
   * {@link mountPaged}'s fit-width layout, which compiles pages that wide).
   */
  layout?: "fixed" | "fit-width";
  /** Build the selectable text layer. Default true. */
  textLayer?: boolean;
  /** Where safe links open (`target`); `null` leaves it to the browser. Default `"_blank"`. */
  linkTarget?: string | null;
  /** How far outside the viewport a page still counts as visible (IntersectionObserver `rootMargin`). Default `"50%"`. */
  rootMargin?: string;
  /** Called after each batch of drawing (telemetry, tests). @beta */
  onDraw?: (info: DrawInfo) => void;
}

/** One batch of drawing by a {@link PagedView}. @beta */
export interface DrawInfo {
  /** Zero-based indices of the pages whose SVG was drawn. */
  pages: number[];
  /** Zero-based indices of the pages whose text layer was built. */
  textLayers: number[];
  /** Main-thread time of the batch, in ms (style, layout and paint follow later). */
  ms: number;
  /** `frame`: visible pages at the next frame; `idle`: in idle time; `flush`: {@link PagedView.flush}. */
  when: "frame" | "idle" | "flush";
}

/** A mounted paged renderer. @public */
export interface PagedView {
  /** The element holding the pages (`.typstream-paged`), appended to the container. */
  readonly element: HTMLElement;
  /**
   * Shows `artifact`. A complete artifact (`base: null`) or changed pages both
   * work: pages are matched by index and redrawn only when their hash differs.
   * Pages past `pageCount` are removed.
   */
  render(artifact: PagedArtifact): void;
  /** Pages and text layers waiting for idle time or the next frame. */
  readonly pending: number;
  /** Draws everything pending now (before printing, in tests). */
  flush(): void;
  /** Removes the pages and stops all observers and callbacks. */
  destroy(): void;
}

interface Slot {
  /** `.typstream-page`: sized from the page, `content-visibility: auto`. */
  el: HTMLElement;
  /** Shadow root holding the page SVG. */
  svg: ShadowRoot;
  /** `.typstream-text-layer`, in the light DOM so selection and find work across pages. */
  text: HTMLElement | null;
  /** The newest page for this index. */
  want: PageUpdate;
  /** Hash of the SVG and of the text layer on screen. */
  drawn: string | null;
  texted: string | null;
  visible: boolean;
  /** The IntersectionObserver has reported on it, so `visible` is known. */
  seen: boolean;
}

const CSS = `
.typstream-paged { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.typstream-paged[data-layout="fit-width"] { align-items: stretch; gap: 0; }
.typstream-page { position: relative; max-width: 100%; container-type: inline-size; content-visibility: auto; background: white; }
${TEXT_LAYER_CSS}`;

const SHEET = Symbol.for("typstream.paged.css");

/** Adds the renderer's CSS to the document once (a constructed sheet, which strict CSPs allow). */
const ensureStyles = (doc: Document) => {
  const holder = doc as Document & { [SHEET]?: true };
  if (holder[SHEET]) return;
  holder[SHEET] = true;
  if ("adoptedStyleSheets" in doc && typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } else {
    const style = doc.createElement("style");
    style.textContent = CSS;
    doc.head.append(style);
  }
};

/** CSS px per point. */
const PX_PER_PT = 4 / 3;

/**
 * Renders paged artifacts into `container`. Framework-free; {@link mountPaged}
 * wires it to an `EngineDocument`.
 * @public
 */
export const createPagedView = (container: HTMLElement, options: PagedViewOptions = {}): PagedView => {
  const layout = options.layout ?? "fixed";
  const wantText = options.textLayer ?? true;
  const linkTarget = options.linkTarget === undefined ? "_blank" : options.linkTarget;
  const doc = container.ownerDocument;
  ensureStyles(doc);

  const element = doc.createElement("div");
  element.className = "typstream-paged";
  element.dataset.layout = layout;
  container.append(element);

  const slots: Slot[] = [];
  /** Slots whose SVG or text layer is out of date. */
  const dirty = new Set<Slot>();
  let frameHandle: number | null = null;
  let cancelIdle: Cancel | null = null;
  let destroyed = false;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const slot = slots.find((s) => s.el === entry.target);
        if (!slot) continue;
        slot.seen = true;
        slot.visible = entry.isIntersecting;
        // A page scrolled into view is drawn at the next frame, not in idle time.
        if (slot.visible && slot.drawn !== slot.want.hash) schedule();
      }
    },
    { rootMargin: options.rootMargin ?? "50%" },
  );

  const size = (slot: Slot, page: PageUpdate) => {
    const style = slot.el.style;
    style.aspectRatio = `${page.width} / ${page.height}`;
    style.width = layout === "fit-width" ? "100%" : `${page.width * PX_PER_PT}px`;
    // What an offscreen (skipped) page measures; `auto` remembers its last real size.
    style.containIntrinsicSize = `auto ${page.width * PX_PER_PT}px auto ${page.height * PX_PER_PT}px`;
  };

  // The batch being drawn, for onDraw.
  let batch: DrawInfo | null = null;
  const begin = (when: DrawInfo["when"]) => {
    if (options.onDraw) batch = { pages: [], textLayers: [], ms: performance.now(), when };
  };
  const end = () => {
    if (!batch) return;
    const info = batch;
    batch = null;
    info.ms = performance.now() - info.ms;
    if (info.pages.length + info.textLayers.length > 0) options.onDraw?.(info);
  };

  const drawSvg = (slot: Slot) => {
    const page = slot.want;
    batch?.pages.push(page.index);
    slot.svg.innerHTML = page.svg;
    const svg = slot.svg.firstElementChild as SVGSVGElement | null;
    if (svg) {
      svg.style.display = "block";
      svg.style.width = "100%";
      svg.style.height = "auto";
      // The text layer is what assistive technology reads.
      svg.setAttribute("aria-hidden", "true");
    }
    sanitizeLinks(slot.svg, linkTarget);
    slot.drawn = page.hash;
  };

  const drawText = (slot: Slot) => {
    const page = slot.want;
    batch?.textLayers.push(page.index);
    if (!slot.text) {
      slot.text = doc.createElement("div");
      slot.text.className = "typstream-text-layer";
      slot.el.append(slot.text);
    }
    fillTextLayer(slot.text, page.text ?? [], page.width);
    slot.texted = page.hash;
  };

  const needsSvg = (slot: Slot) => slot.drawn !== slot.want.hash;
  const needsText = (slot: Slot) => wantText && slot.texted !== slot.want.hash && slot.drawn === slot.want.hash;

  /** Visible pages' SVGs, at the next frame. */
  const drawVisible = () => {
    frameHandle = null;
    begin("frame");
    for (const slot of dirty) {
      if (!slot.visible || !needsSvg(slot)) continue;
      drawSvg(slot);
      if (!needsText(slot)) dirty.delete(slot);
    }
    end();
    if (dirty.size > 0) idleLater();
  };

  /** Offscreen SVGs, then text layers (visible pages first), while the browser is idle. */
  const drawIdle = (timeRemaining: () => number) => {
    cancelIdle = null;
    begin("idle");
    try {
      drawIdleBatch(timeRemaining);
    } finally {
      end();
    }
  };
  const drawIdleBatch = (timeRemaining: () => number) => {
    const order = [...dirty].sort((a, b) => Number(b.visible) - Number(a.visible));
    // SVGs before text layers: a blank page is worse than an unselectable one.
    for (const pass of [needsSvg, needsText])
      for (const slot of order) {
        if (!dirty.has(slot) || !pass(slot)) continue;
        if (pass === needsSvg) drawSvg(slot);
        else drawText(slot);
        if (!needsSvg(slot) && !needsText(slot)) dirty.delete(slot);
        if (timeRemaining() <= 0) return idleLater();
      }
    for (const slot of order) if (!needsSvg(slot) && !needsText(slot)) dirty.delete(slot);
    if (dirty.size > 0) idleLater();
  };

  const idleLater = () => {
    if (cancelIdle === null && !destroyed) cancelIdle = idle(drawIdle);
  };

  // Idle work starts once the frame has drawn the visible pages (drawVisible
  // queues it). Started here too, WebKit's timer fallback can fire before the
  // frame and draw visible pages in idle time instead.
  const schedule = () => {
    if (destroyed || frameHandle !== null) return;
    frameHandle = requestAnimationFrame(drawVisible);
  };

  const addSlot = (page: PageUpdate, visible: boolean): Slot => {
    const el = doc.createElement("div");
    el.className = "typstream-page";
    el.dataset.page = String(page.index + 1);
    const host = doc.createElement("div");
    const svg = host.attachShadow({ mode: "open" });
    const slot: Slot = { el, svg, text: null, want: page, drawn: null, texted: null, visible, seen: false };
    el.append(host);
    element.append(el);
    io.observe(el);
    return slot;
  };

  return {
    element,
    render(artifact) {
      if (destroyed) return;
      while (slots.length > artifact.pageCount) {
        const slot = slots.pop() as Slot;
        io.unobserve(slot.el);
        dirty.delete(slot);
        slot.el.remove();
      }
      for (const page of artifact.pages) {
        if (page.index >= artifact.pageCount) continue;
        let slot = slots[page.index];
        if (!slot) {
          // Not observed yet. New pages appear at the end, where streaming
          // happens, so count one as visible when the page before it is known
          // to be (or it is among the first two): drawing it next frame beats a
          // blank flash.
          const before = slots[page.index - 1];
          slot = addSlot(page, page.index < 2 || (before?.seen === true && before.visible));
          slots[page.index] = slot;
        }
        if (slot.want.hash === page.hash && slot.drawn !== null) continue;
        if (slot.want.width !== page.width || slot.want.height !== page.height || slot.drawn === null) size(slot, page);
        slot.want = page;
        dirty.add(slot);
      }
      if (dirty.size > 0) schedule();
    },
    get pending() {
      let n = 0;
      for (const slot of dirty) n += Number(needsSvg(slot)) + Number(wantText && slot.texted !== slot.want.hash);
      return n;
    },
    flush() {
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      frameHandle = null;
      cancelIdle?.();
      cancelIdle = null;
      begin("flush");
      for (const slot of dirty) {
        if (needsSvg(slot)) drawSvg(slot);
        if (needsText(slot)) drawText(slot);
      }
      dirty.clear();
      end();
    },
    destroy() {
      destroyed = true;
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      cancelIdle?.();
      io.disconnect();
      dirty.clear();
      slots.length = 0;
      element.remove();
    },
  };
};
