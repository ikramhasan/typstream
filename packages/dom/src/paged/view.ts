// The paged renderer (PLAN §6.5, #14): one element per page, kept in step with
// paged artifacts. Only pages whose hash changed are redrawn; visible ones at
// the next frame, the rest when the browser is idle (or when they scroll into
// view). Text layers are always built in idle time.
//
// Decisions measured in #14 (Chromium, Firefox, WebKit; 19 dense A4 pages):
// - Pages that come as drawings (`pageFormat: "drawing"`, what mountPaged asks
//   for) are painted on a canvas: 1 ms per streamed update in Chromium and
//   WebKit, 10–15 ms in Firefox, where an SVG page cost 12–31 ms of style and
//   layout (one <use> per glyph). A canvas holds 8–14 MB of pixels per A4 page
//   at a device pixel ratio of 2, so only pages near the viewport keep theirs;
//   the others are painted again when they come back, which is cheap. Canvases
//   follow the device pixel ratio and pinch zoom (repainted once it settles),
//   and are painted whole before printing. Links are <a>s over the canvas.
// - Pages that come as SVG (the engine can't draw them, or the document asked
//   for SVG) are drawn as before. Each page's SVG lives in its own shadow root. typst-svg repeats the glyph
//   <symbol>s a page uses under content-hash ids (`g…`), so inline pages share
//   ids. In Chromium, swapping one page then re-resolves every <use> in the
//   document: ~300 ms per streamed update at 19 pages, vs ~20 ms with ids
//   scoped per page. A shadow root scopes them without rewriting the markup, and
//   keeps the app's CSS off the SVG.
// - Glyph defs are not shared across pages. They are 29% of the bytes, but the
//   time goes to style and layout of the <use>s, which sharing doesn't remove.
// - Page SVGs have `content-visibility: auto`, so the browser skips offscreen
//   ones. Their text layers don't (#63): skipped content leaves the
//   accessibility tree (Chromium kept 2 of a 6-page report's 16 headings), and
//   screen readers must reach every page's headings. A layer is cheap next to
//   its SVG, and `contain: strict` keeps its relayout to itself.

import { type PagedArtifact, type PageUpdate, trustedHTML } from "@typstream/core";
import { isSafeHref, sanitizeLinks } from "./links";
import { type Images, paint, sameDrawing } from "./paint";
import { type Cancel, idle } from "./schedule";
import { fillTextLayer, TEXT_LAYER_CSS } from "./text-layer";

/** Options of {@link createPagedView}. @public */
export interface PagedViewOptions {
  /**
   * `fixed` (default): pages at their authored size, scaled down to fit the
   * container. `fit-width`: the same pages scaled up or down to the container's
   * width, as a PDF viewer's "fit width" shows them. `reflow`: pages fill the
   * container's width with no space between them (use it with
   * {@link mountPaged}'s reflow layout, which compiles pages that wide).
   */
  layout?: "fixed" | "fit-width" | "reflow";
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
  /** Zero-based indices of the pages drawn: their SVG put in, or their canvas painted. */
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
  /** `.typstream-page`: sized from the page. */
  el: HTMLElement;
  /** Its first child: a host whose shadow root holds an SVG page, or a canvas for drawn pages. */
  svg: ShadowRoot | null;
  canvas: HTMLCanvasElement | null;
  /** `.typstream-text-layer`, in the light DOM so selection and find work across pages. */
  text: HTMLElement | null;
  /** `.typstream-links` over a drawn page. */
  links: HTMLElement | null;
  /** The newest page for this index. */
  want: PageUpdate;
  /** Hash of the page shown (SVG put in, or drawing given to the canvas) and of the text layer. */
  drawn: string | null;
  texted: string | null;
  /** Width in device pixels the canvas was painted at; 0 while it has no pixels. */
  painted: number;
  visible: boolean;
  /** The IntersectionObserver has reported on it, so `visible` is known. */
  seen: boolean;
}

const CSS = `
.typstream-paged { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.typstream-paged[data-layout="fit-width"] { align-items: stretch; }
.typstream-paged[data-layout="reflow"] { align-items: stretch; gap: 0; }
.typstream-page { position: relative; max-width: 100%; container-type: inline-size; background: white; }
.typstream-page > :first-child { position: absolute; inset: 0; width: 100%; height: 100%; }
.typstream-page > div:first-child { content-visibility: auto; }
.typstream-links { position: absolute; inset: 0; pointer-events: none; }
.typstream-links a { position: absolute; pointer-events: auto; }
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

/** Two versions of a page have the same text layer: runs, structure, language and direction. */
const sameText = (a: PageUpdate, b: PageUpdate): boolean =>
  a.lang === b.lang &&
  a.dir === b.dir &&
  (a.text === b.text || (a.text?.length === b.text?.length && JSON.stringify(a.text) === JSON.stringify(b.text))) &&
  JSON.stringify(a.structure) === JSON.stringify(b.structure);

/** CSS px per point. */
const PX_PER_PT = 4 / 3;

/** Most pixels a canvas may have: Safari's limit (iOS draws nothing above it). */
const MAX_PIXELS = 16_777_216;

/** Device pixels per CSS pixel to paint at: the device's, times pinch zoom. */
const pixelRatio = (win: Window): number => win.devicePixelRatio * Math.max(1, win.visualViewport?.scale ?? 1);

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
  const win = doc.defaultView as Window;
  // Pages are parsed here first (inert: nothing loads), so links and images are filtered before they reach the page.
  const template = doc.createElement("template");
  const images: Images = new Map();
  ensureStyles(doc);

  const element = doc.createElement("div");
  element.className = "typstream-paged";
  element.dataset.layout = layout;
  container.append(element);

  const slots: Slot[] = [];
  /** Slots whose page or text layer is out of date. */
  const dirty = new Set<Slot>();
  let frameHandle: number | null = null;
  let cancelIdle: Cancel | null = null;
  let destroyed = false;
  /** Device pixels per CSS pixel canvases are painted at; set before printing. */
  let printing = 0;

  const release = (slot: Slot) => {
    if (!slot.canvas || slot.painted === 0) return;
    slot.canvas.width = slot.canvas.height = 0;
    slot.painted = 0;
  };
  // Pages that left the viewport give their pixels up a second later, unless
  // they are back: a page streamed in below the fold and scrolled to isn't
  // painted twice.
  let sweepTimer: ReturnType<typeof setTimeout> | undefined;
  const sweep = () => {
    for (const slot of slots) if (!slot.visible && !printing) release(slot);
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const slot = slots.find((s) => s.el === entry.target);
        if (!slot) continue;
        slot.seen = true;
        slot.visible = entry.isIntersecting;
        // A page scrolled into view is drawn at the next frame, not in idle time.
        if (slot.visible && (needsPage(slot) || needsPaint(slot))) schedule();
        if (!slot.visible) {
          clearTimeout(sweepTimer);
          sweepTimer = setTimeout(sweep, 1000);
        }
      }
    },
    { rootMargin: options.rootMargin ?? "50%" },
  );
  // A page that changes size (fit-width, reflow, a narrower container) is painted again.
  const ro = new ResizeObserver(() => {
    if (slots.some(needsPaint)) schedule();
  });

  // Zoom changes the device pixel ratio (and fires `resize`); pinch zoom
  // scales the visual viewport. Visible canvases are painted again once it settles.
  let zoomTimer: ReturnType<typeof setTimeout> | undefined;
  const onZoom = () => {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(schedule, 150);
  };
  // Printing prints canvases as they are: paint every page first, at least at twice the CSS resolution.
  const beforePrint = () => {
    printing = Math.max(2, pixelRatio(win));
    flush();
  };
  const afterPrint = () => {
    printing = 0;
    sweep();
    schedule();
  };
  win.addEventListener("resize", onZoom);
  win.visualViewport?.addEventListener("resize", onZoom);
  win.addEventListener("beforeprint", beforePrint);
  win.addEventListener("afterprint", afterPrint);

  const size = (slot: Slot, page: PageUpdate) => {
    const style = slot.el.style;
    style.aspectRatio = `${page.width} / ${page.height}`;
    style.width = layout === "fixed" ? `${page.width * PX_PER_PT}px` : "100%";
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

  /** The page's graphics: a canvas, or a host for an SVG shadow root, first in the page. */
  const graphics = (slot: Slot, canvas: boolean) => {
    if (canvas ? slot.canvas : slot.svg) return;
    slot.el.firstElementChild?.remove();
    slot.svg = null;
    slot.canvas = null;
    slot.painted = 0;
    if (canvas) {
      slot.canvas = doc.createElement("canvas");
      // No pixels until it is painted (a canvas starts at 300 × 150).
      slot.canvas.width = slot.canvas.height = 0;
      // The text layer is what assistive technology reads.
      slot.canvas.setAttribute("aria-hidden", "true");
      slot.el.prepend(slot.canvas);
    } else {
      const host = doc.createElement("div");
      slot.svg = host.attachShadow({ mode: "open" });
      slot.el.prepend(host);
    }
  };

  /** Shows the page that `slot` wants: its SVG, or its drawing, painted if it is visible. */
  const showPage = (slot: Slot) => {
    const page = slot.want;
    graphics(slot, !!page.drawing);
    slot.drawn = page.hash;
    showLinks(slot);
    if (page.drawing) {
      // Painted with the other visible pages (`paintAll`); offscreen, its pixels go.
      if (slot.visible || printing) slot.painted = -1;
      else release(slot);
      return;
    }
    batch?.pages.push(page.index);
    // Under Trusted Types (#70) through typstream's policy, for the inert template.
    template.innerHTML = trustedHTML(page.svg);
    sanitizeLinks(template.content, linkTarget);
    const root = slot.svg as ShadowRoot;
    root.replaceChildren(template.content);
    const svg = root.firstElementChild as SVGSVGElement | null;
    if (svg) {
      svg.style.display = "block";
      svg.style.width = "100%";
      svg.style.height = "auto";
      // The text layer is what assistive technology reads.
      svg.setAttribute("aria-hidden", "true");
    }
  };

  /** The canvas width to paint `slot` at, in device pixels. */
  const target = (slot: Slot) => {
    const { width, height } = slot.want;
    const css = slot.el.clientWidth;
    return Math.round(Math.min(css * (printing || pixelRatio(win)), Math.sqrt((MAX_PIXELS * width) / height)));
  };

  /** Paints the canvases that need it: sizes first, then pixels, so layout is read once. */
  const paintAll = () => {
    const todo: [Slot, number][] = [];
    for (const slot of slots) {
      if (!slot.canvas || slot.drawn !== slot.want.hash || !(slot.visible || printing)) continue;
      const width = target(slot);
      if (width > 0 && width !== slot.painted) todo.push([slot, width]);
    }
    for (const [slot, width] of todo) paintSlot(slot, width);
  };

  const paintSlot = (slot: Slot, width: number) => {
    const page = slot.want;
    const canvas = slot.canvas as HTMLCanvasElement;
    batch?.pages.push(page.index);
    const height = Math.round((width * page.height) / page.width);
    // Setting a canvas's size reallocates it, even to the same size.
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    slot.painted = width;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    paint(ctx, page.drawing as NonNullable<PageUpdate["drawing"]>, width / page.width, images, () => {
      // An image arrived: paint again with it.
      slot.painted = -1;
      schedule();
    });
  };

  /** Links over a drawn page (an SVG page has its own). */
  const showLinks = (slot: Slot) => {
    const page = slot.want;
    const links = page.drawing?.links.filter((link) => isSafeHref(link.url)) ?? [];
    if (links.length === 0) {
      slot.links?.remove();
      slot.links = null;
      return;
    }
    if (!slot.links) {
      slot.links = doc.createElement("div");
      slot.links.className = "typstream-links";
      slot.el.append(slot.links);
    }
    // In `cqw` of the page, like the text layer.
    const cqw = (pt: number) => `${((pt * 100) / page.width).toFixed(4)}cqw`;
    slot.links.replaceChildren(
      ...links.map((link) => {
        const a = doc.createElement("a");
        a.href = link.url;
        if (linkTarget !== null) {
          a.target = linkTarget;
          a.rel = "noopener noreferrer";
        }
        // As the links in an SVG page, which is aria-hidden: the text layer holds their text.
        a.tabIndex = -1;
        a.setAttribute("aria-hidden", "true");
        Object.assign(a.style, {
          left: cqw(link.x),
          top: cqw(link.y),
          width: cqw(link.width),
          height: cqw(link.height),
        });
        return a;
      }),
    );
  };

  const drawText = (slot: Slot) => {
    const page = slot.want;
    batch?.textLayers.push(page.index);
    if (!slot.text) {
      slot.text = doc.createElement("div");
      slot.text.className = "typstream-text-layer";
      // Under the links.
      slot.el.insertBefore(slot.text, slot.links);
    }
    fillTextLayer(slot.text, page);
    slot.texted = page.hash;
  };

  const needsPage = (slot: Slot) => slot.drawn !== slot.want.hash;
  const needsText = (slot: Slot) => wantText && slot.texted !== slot.want.hash && slot.drawn === slot.want.hash;
  // A visible canvas without pixels, or painted at another size than it would be now.
  const needsPaint = (slot: Slot) =>
    !!slot.canvas && slot.drawn === slot.want.hash && (slot.visible || printing > 0) && slot.painted !== target(slot);

  /** Visible pages, at the next frame. */
  const drawVisible = () => {
    frameHandle = null;
    begin("frame");
    for (const slot of dirty) {
      if (!slot.visible || !needsPage(slot)) continue;
      showPage(slot);
      if (!needsText(slot)) dirty.delete(slot);
    }
    paintAll();
    end();
    if (dirty.size > 0) idleLater();
  };

  /** Offscreen pages, then text layers (visible pages first), while the browser is idle. */
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
    // Pages before text layers: a blank page is worse than an unselectable one.
    for (const pass of [needsPage, needsText])
      for (const slot of order) {
        if (!dirty.has(slot) || !pass(slot)) continue;
        if (pass === needsPage) showPage(slot);
        else drawText(slot);
        if (!needsPage(slot) && !needsText(slot)) dirty.delete(slot);
        if (timeRemaining() <= 0) return idleLater();
      }
    for (const slot of order) if (!needsPage(slot) && !needsText(slot)) dirty.delete(slot);
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
    const slot: Slot = {
      el,
      svg: null,
      canvas: null,
      text: null,
      links: null,
      want: page,
      drawn: null,
      texted: null,
      painted: 0,
      visible,
      seen: false,
    };
    element.append(el);
    io.observe(el);
    ro.observe(el);
    return slot;
  };

  const flush = () => {
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
    cancelIdle?.();
    cancelIdle = null;
    begin("flush");
    for (const slot of dirty) {
      if (needsPage(slot)) showPage(slot);
      if (needsText(slot)) drawText(slot);
    }
    dirty.clear();
    paintAll();
    end();
  };

  return {
    element,
    render(artifact) {
      if (destroyed) return;
      while (slots.length > artifact.pageCount) {
        const slot = slots.pop() as Slot;
        io.unobserve(slot.el);
        ro.unobserve(slot.el);
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
        if (slot.want.hash === page.hash && slot.drawn !== null && !slot.want.drawing === !page.drawing) continue;
        // The same page under a new hash: Typst's frame hashes include source spans,
        // which change when text before them is reparsed. Keep what's on screen.
        if (
          slot.drawn === slot.want.hash &&
          slot.want.svg === page.svg &&
          sameDrawing(slot.want.drawing, page.drawing)
        ) {
          const sameLayer = slot.texted === slot.want.hash && sameText(slot.want, page);
          if (sameLayer) slot.texted = page.hash;
          slot.drawn = page.hash;
          slot.want = page;
          // Its text layer can still differ (structure or language without a visible change).
          if (!sameLayer && wantText) dirty.add(slot);
          continue;
        }
        if (slot.want.width !== page.width || slot.want.height !== page.height || slot.drawn === null) size(slot, page);
        // The same hash in the other format (SVG or drawing) is drawn again.
        if (slot.drawn === page.hash) slot.drawn = null;
        slot.want = page;
        dirty.add(slot);
      }
      if (dirty.size > 0) schedule();
    },
    get pending() {
      let n = 0;
      for (const slot of dirty) n += Number(needsPage(slot)) + Number(wantText && slot.texted !== slot.want.hash);
      for (const slot of slots) n += Number(needsPaint(slot));
      return n;
    },
    flush,
    destroy() {
      destroyed = true;
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      cancelIdle?.();
      clearTimeout(zoomTimer);
      clearTimeout(sweepTimer);
      io.disconnect();
      ro.disconnect();
      win.removeEventListener("resize", onZoom);
      win.visualViewport?.removeEventListener("resize", onZoom);
      win.removeEventListener("beforeprint", beforePrint);
      win.removeEventListener("afterprint", afterPrint);
      dirty.clear();
      slots.length = 0;
      element.remove();
    },
  };
};
