// Pages for the HTML target: the document laid out as the paged view shows it (#118's look), on sheets of its page
// size with its margins, breaking where Typst breaks pages.
//
// The flow is one element over the sheets, as wide as a page's text and scaled as the paged view scales its pages
// (`fixed`, `fit-width`, `reflow`). Its lines break where Typst's do: the HTML is set in Typst's fonts and metrics
// (html-compat's CSS, `registerTypstFonts`). Page breaks are spacers put into the flow where a page ends: before a
// block, or inside a paragraph before a line (a block-level span there splits it without moving its line breaks),
// so the DOM stays one flow (selection, find in page, screen readers) and the sheets only draw paper behind it.
//
// Where a page ends follows Typst's flow (typst-layout's flow/collect.rs and distribute.rs): whole lines; a
// paragraph keeps two lines together at its start and at its end (orphans and widows, all three of a three-line
// one); unbreakable blocks (`.ts-whole`, figures, tables' rows, drawings) move whole to the next page; a sticky
// block (a heading) goes with what follows it; spacing at the top of a page is dropped; `pagebreak()` starts one.
//
// The page comes from html-compat, which writes it on the source anchors (`data-page`: width, height, margins and
// fill in points); without it, A4 with Typst's default margins.

/** A page's size, margins and fill, in points. */
export interface PageGeometry {
  width: number;
  /** `null`: as tall as its content (Typst's `height: auto`). */
  height: number | null;
  /** Top, right, bottom, left. */
  margin: [number, number, number, number];
  fill: string | null;
  /** How far above the top margin's end the header ends, and below the bottom margin's start the footer starts. */
  ascent: number;
  descent: number;
  /** Its columns (`set page(columns: n)`) and the gutter between them, in points. */
  columns?: number;
  gutter?: number;
  /** How far the text moves on even pages (inside and outside margins), in points. */
  binding?: number;
}

/** A4 with Typst's default margins (2.5/21 of the shorter side). */
export const A4: PageGeometry = {
  width: 595.28,
  height: 841.89,
  margin: [70.87, 70.87, 70.87, 70.87],
  fill: null,
  ascent: 21.26,
  descent: 21.26,
};

/** html-compat's `data-page`: `width height top right bottom left fill ascent descent columns gutter binding`. */
export const parseGeometry = (attr: string | null | undefined): PageGeometry => {
  const parts = attr?.trim().split(/\s+/) ?? [];
  const n = parts.slice(0, 6).map(Number);
  if (parts.length < 6 || n.some((v, i) => (i === 1 ? false : !Number.isFinite(v)))) return A4;
  const [width, height, top, right, bottom, left] = n as [number, number, number, number, number, number];
  const fill = parts[6] && parts[6] !== "none" ? parts[6] : null;
  const [ascent, descent] = [parts[7], parts[8]].map((v) => Number(v ?? Number.NaN));
  return {
    width,
    height: parts[1] === "auto" ? null : height,
    margin: [top, right, bottom, left],
    fill,
    ascent: Number.isFinite(ascent) ? (ascent as number) : top * 0.3,
    descent: Number.isFinite(descent) ? (descent as number) : bottom * 0.3,
    ...(Number(parts[9]) > 1 ? { columns: Number(parts[9]), gutter: Number(parts[10]) || 0 } : {}),
    ...(Number(parts[11]) ? { binding: Number(parts[11]) } : {}),
  };
};

/** CSS px per point. */
const PX = 4 / 3;
/** How far (px) a unit may stand past a page's end and still count as on it: rounding of line boxes. */
const EPS = 0.5;

/** How the pages are shown: as the paged view's layouts. */
export type PagesLayout = "fixed" | "fit-width" | "reflow";

/** The pages of an HTML document. */
export interface HtmlPages {
  /** Where the document goes. */
  readonly flow: HTMLElement;
  /** The page the document is on; lays the pages out again when it changed. */
  setGeometry(geometry: PageGeometry): void;
  /**
   * The page's header and footer (html-compat's `.ts-page-header` and `.ts-page-footer`, `.ts-first` on the first
   * page's), sanitized, put on every page with its number and the page count in place of html-compat's.
   */
  setMarginals(nodes: readonly Node[]): void;
  /**
   * Breaks the flow into pages again (after the document changed): from the page `from` (the first node that
   * changed) is on, the pages before it kept as they are; all of them without it.
   */
  layout(from?: Node | null): void;
  /** The sheets shown. */
  readonly count: number;
  dispose(): void;
}

/** Where a page break goes: what puts space before a unit, and takes it out again. */
interface Gap {
  set(px: number): void;
  remove(): void;
  /** Where it is: the spacer, or a cell of the row it moves. */
  node: Node;
  /** The page it starts. */
  page: number;
}

/** Something that doesn't break across pages: a line, a block that doesn't break, a table's row. */
interface Unit {
  /** Its top and bottom in the flow, px, unscaled, read when asked (breaks before it move it). */
  measure(): { top: number; bottom: number };
  /** Makes room before it. */
  gap(): Gap;
  /** Lines of one paragraph: this one's index and how many there are, and the paragraph's units. */
  par?: { index: number; lines: Unit[] };
  /** The sticky block (a heading) it belongs to. */
  sticky?: Element;
  /** A forced page break comes before it: `weak` when there is none at the top of a page. */
  force?: boolean | "weak" | "column";
  /** Fits it to the room left on its page (px), before it is measured there: columns fill it as Typst's do. */
  fit?(room: number): void;
  /** Fractional spacing (html-compat's `.ts-vfill`): its share of the room its page's content leaves. */
  fr?: HTMLElement;
  /** The first unit of a block aligned in its page (html-compat's `.ts-align-v`): to its middle or its end. */
  align?: { el: Element; at: number };
  /** The footnotes referenced in it (their entries in Typst's endnotes), which go at the foot of its page. */
  notes?: HTMLElement[];
  /** A node it is in: the boxes around it inset it from a page's end (`insetBelow`). */
  host?: Node;
}

const SPACER = "typstream-break";
/** A footnote's reference (typst-html's), and the endnotes it links into. */
const NOTEREF = 'sup[role="doc-noteref"]';
const ENDNOTES = 'section[role="doc-endnotes"]';
/** What html-compat writes for the page number in headers and footers. */
const PAGE_NUMBER = 3999;

/** Elements that don't break across pages. A closed `<details>` too: what it hides has no place to measure. */
const WHOLE =
  ".ts-whole, figure, img, svg, math, typstream-island, .ts-frame, .ts-shape, .ts-line, .ts-columns, pre, .typstream-island, details:not([open]), .ts-float-parent";
/** Sticky blocks: they move to the next page with what follows them. */
const STICKY = "h1, h2, h3, h4, h5, h6, .ts-sticky";

/** Blocks with spacing of their own above and below (headings; html-compat's `.ts-sp-a`, `.ts-sp-b`). */
const OWN_ABOVE = "h1, h2, h3, h4, h5, h6, .ts-sp-a";
const OWN_BELOW = "h1, h2, h3, h4, h5, h6, .ts-sp-b";

/**
 * Spacing (`v`) between two blocks whose spacings are alike (both their own, or both paragraph spacing): Typst adds
 * it to the larger of the two (distribute.rs, keep_spacing), which CSS can't pick. Such a `v` is `.ts-v-both`, where
 * html-compat's CSS keeps both spacings, and a negative bottom margin as large as the smaller takes it back (margins
 * collapse: the larger stays). The spacings are measured as the gaps around the `v`, so a first or last child's
 * margin that collapses through its block counts. (Unalike, the block's own wins: the CSS.)
 */
const collapseSpacing = (root: HTMLElement, view: Window, scale: number) => {
  const pairs: [HTMLElement, HTMLElement, HTMLElement][] = [];
  for (const v of root.querySelectorAll<HTMLElement>(".ts-v:not(.ts-v-weak, .ts-vfill)")) {
    // Past the pages' spacers: a layout from a later block keeps those before it.
    let before = v.previousElementSibling as HTMLElement | null;
    while (before?.classList.contains(SPACER)) before = before.previousElementSibling as HTMLElement | null;
    let after = v.nextElementSibling as HTMLElement | null;
    while (after?.classList.contains(SPACER)) after = after.nextElementSibling as HTMLElement | null;
    const alike =
      !!before &&
      !!after &&
      before.matches(OWN_BELOW) === after.matches(OWN_ABOVE) &&
      isBlock(before, view) &&
      isBlock(after, view);
    v.classList.toggle("ts-v-both", alike);
    v.style.marginBlockEnd = "";
    // Without height its margins collapse through it, with the blocks': the larger stays as it is.
    if (alike && v.offsetHeight > 0) pairs.push([before as HTMLElement, v, after as HTMLElement]);
  }
  const gaps = pairs.map(([before, v, after]) => {
    const box = v.getBoundingClientRect();
    return Math.min(box.top - before.getBoundingClientRect().bottom, after.getBoundingClientRect().top - box.bottom);
  });
  for (const [i, [, v]] of pairs.entries()) {
    const smaller = (gaps[i] as number) / scale;
    if (smaller > 0) v.style.marginBlockEnd = `${-smaller}px`;
  }
};

const isBlock = (el: Element, view: Window): boolean => {
  const display = view.getComputedStyle(el).display;
  return !display.startsWith("inline") && display !== "contents" && display !== "none" && display !== "ruby";
};

const outOfFlow = (el: Element, view: Window): boolean => {
  const style = view.getComputedStyle(el);
  return style.position === "absolute" || style.position === "fixed" || style.display === "none";
};

/** Lays the document in `flow` out on sheets in `sheets`. */
export const createHtmlPages = (
  root: HTMLElement,
  layout: PagesLayout = "fixed",
  onCount?: (count: number) => void,
  /** The header and footer html-compat wrote on a block's anchor (`data-typstream-parts`), parsed. */
  partsOf?: (id: string) => readonly Node[],
): HtmlPages => {
  const doc = root.ownerDocument;
  const view = doc.defaultView as Window & typeof globalThis;
  const sheets = doc.createElement("div");
  sheets.className = "typstream-paged";
  sheets.dataset.layout = layout;
  const flow = doc.createElement("div");
  flow.className = "typstream-flow";
  // Headers and footers, placed and scaled as the flow is.
  const marginals = doc.createElement("div");
  marginals.className = "typstream-flow typstream-marginals";
  marginals.setAttribute("aria-hidden", "true");
  // Under the flow, placed and scaled as it is: the pieces of boxes broken across pages.
  const underlay = doc.createElement("div");
  underlay.className = "typstream-underlay";
  underlay.setAttribute("aria-hidden", "true");
  root.append(sheets, underlay, flow, marginals);
  let parts: readonly Node[] = [];
  let partsKey = "";
  root.classList.add("typstream-pages");

  let geometry: PageGeometry = A4;
  let gaps: Gap[] = [];
  /** The room above blocks aligned in their page: laid out again with all the pages. */
  let shifts: Gap[] = [];
  let count = 0;
  let scale = 1;

  /** The page's width in px: the element's in the reflow layout. */
  const pageWidth = () => (layout === "reflow" ? root.clientWidth || geometry.width * PX : geometry.width * PX);

  const sheet = (i: number): HTMLElement => {
    while (sheets.children.length <= i) {
      const el = doc.createElement("div");
      el.className = "typstream-page";
      el.setAttribute("aria-hidden", "true");
      sheets.append(el);
    }
    return sheets.children[i] as HTMLElement;
  };

  /** Sizes the sheets and puts the flow over the first, scaled as it is. */
  const place = () => {
    const width = pageWidth();
    const [top, right, bottom, left] = geometry.margin.map((m) => m * PX) as [number, number, number, number];
    for (const el of sheets.children as HTMLCollectionOf<HTMLElement>) {
      el.style.width = layout === "fixed" ? `${width}px` : "";
      el.style.background = geometry.fill ?? "";
      el.style.aspectRatio = geometry.height ? `${geometry.width} / ${geometry.height}` : "";
    }
    const first = sheet(0);
    scale = first.clientWidth > 0 ? first.clientWidth / width : 1;
    // Islands undo the scale: their components are laid out at the size the page shows them, as on canvas pages,
    // in the text style of the element the document is in (on canvas pages they are DOM over it, in that style).
    flow.style.setProperty("--typstream-scale", String(scale));
    const host = root.parentElement && view.getComputedStyle(root.parentElement);
    if (host) {
      flow.style.setProperty("--typstream-host-font", host.fontFamily);
      flow.style.setProperty("--typstream-host-size", host.fontSize);
      flow.style.setProperty("--typstream-host-line", host.lineHeight);
      flow.style.setProperty("--typstream-host-color", host.color);
    }
    // Where the first sheet is in the root, to the fraction of a pixel (offsetTop rounds it).
    const box = root.getBoundingClientRect();
    const sheetBox = first.getBoundingClientRect();
    const at = { left: sheetBox.left - box.left - root.clientLeft, top: sheetBox.top - box.top - root.clientTop };
    for (const el of [flow, marginals, underlay])
      Object.assign(el.style, {
        width: `${width}px`,
        padding: `${top}px ${right}px ${bottom}px ${left}px`,
        left: `${at.left}px`,
        top: `${at.top}px`,
        transform: scale === 1 ? "" : `scale(${scale})`,
      });
    // Page columns: the flow is one column wide (its box the page's, so what moves to the next column shows).
    if (columns() > 1) {
      flow.style.paddingRight = `${right + (width - left - right) - columnWidth()}px`;
      flow.style.setProperty("--typstream-text-width", `${width - left - right}px`);
    } else flow.style.removeProperty("--typstream-text-width");
  };

  // --- page runs: each page's number, numbering, header and footer --------------------

  /** A block's page settings that start a page when they change: its geometry and numbering. */
  const runKey = (el: HTMLElement) => `${el.dataset.typstreamPage}|${el.dataset.typstreamNumbering}`;
  const runKeys = () => new Set([...flow.querySelectorAll<HTMLElement>("[data-typstream-page]")].map(runKey));

  /** A number in a numbering's counting symbol (Typst's `1`, `a`, `A`, `i`, `I`). */
  const formatNumber = (n: number, symbol: string): string => {
    if (symbol === "i" || symbol === "I") {
      const table: [number, string][] = [
        [1000, "M"],
        [900, "CM"],
        [500, "D"],
        [400, "CD"],
        [100, "C"],
        [90, "XC"],
        [50, "L"],
        [40, "XL"],
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"],
      ];
      let out = "";
      let rest = n;
      for (const [v, r] of table)
        while (rest >= v) {
          out += r;
          rest -= v;
        }
      return symbol === "i" ? out.toLowerCase() : out;
    }
    if (symbol === "a" || symbol === "A") {
      let out = "";
      for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26))
        out = String.fromCharCode(97 + ((rest - 1) % 26)) + out;
      return symbol === "A" ? out.toUpperCase() : out;
    }
    return String(n);
  };
  const symbolOf = (numbering: string) => /[1aAiI]/.exec(numbering)?.[0] ?? "1";

  /**
   * Each page's number as Typst counts it (up by one a page, from where the document sets the page counter:
   * html-compat's marks, `data-typstream-counter`), its numbering's counting symbol, and the header and footer it
   * shows (those of its first block's page settings).
   */
  let pageInfo: { number: number; symbol: string; parts: string | null }[] = [];
  /** What `el` starts: a page break (`.ts-pagebreak`, at the foot of the page before) or nothing to see starts what
   * comes after it. */
  const startOf = (el: Element): Element => {
    let at: Element | null = el;
    while (at && (at.matches(`.ts-pagebreak, .${SPACER}`) || !(at as HTMLElement).offsetHeight))
      at = at.nextElementSibling;
    return at ?? el;
  };
  const numberPages = () => {
    const tops = [...Array(count).keys()].map(sheetTop);
    const pageOf = (el: Element) => {
      const top = inFlow(el.getBoundingClientRect(), origin()).top;
      let p = 0;
      while (p + 1 < tops.length && (tops[p + 1] as number) <= top + EPS) p++;
      return p;
    };
    const resets = new Map<number, number>();
    for (const el of flow.querySelectorAll<HTMLElement>("[data-typstream-counter]"))
      resets.set(pageOf(startOf(el)), Number(el.dataset.typstreamCounter));
    const first: (HTMLElement | undefined)[] = [];
    const marks = [...flow.querySelectorAll<HTMLElement>("[data-typstream-page]")];
    const at = marks.map((m) => {
      const p = pageOf(startOf(m));
      first[p] ??= m;
      return p;
    });
    pageInfo = [];
    let number = 1;
    let governing: HTMLElement | undefined;
    for (let p = 0; p < count; p++) {
      number = resets.get(p) ?? (p === 0 ? 1 : number + 1);
      governing = first[p] ?? marks.filter((_, i) => (at[i] as number) < p).pop() ?? governing;
      pageInfo.push({
        number,
        symbol: symbolOf(governing?.dataset.typstreamNumbering ?? "1"),
        parts: governing?.dataset.typstreamParts ?? null,
      });
    }
  };

  /** Each page's header and footer, its number and the count written in. */
  const drawMarginals = () => {
    marginals.replaceChildren();
    if (geometry.height === null) return;
    const pick = (kind: string, first: boolean, from: readonly Node[]) =>
      (from.find(
        (n) =>
          n.nodeType === 1 &&
          (n as Element).classList.contains(kind) &&
          (n as Element).classList.contains("ts-first") === first,
      ) as Element | undefined) ?? null;
    const [top, , bottom, left] = geometry.margin.map((m) => m * PX) as [number, number, number, number];
    const width = pageWidth() - left - geometry.margin[1] * PX;
    for (let i = 0; i < count; i++) {
      const info = pageInfo[i];
      const own = info?.parts && partsOf ? partsOf(info.parts) : parts;
      if (!own.length) continue;
      for (const [kind, y, h, end] of [
        ["ts-page-header", sheetTop(i), top - geometry.ascent * PX, true],
        [
          "ts-page-footer",
          sheetTop(i) + pageHeight() - bottom + geometry.descent * PX,
          bottom - geometry.descent * PX,
          false,
        ],
      ] as const) {
        const part = pick(kind, (info?.number ?? i + 1) === 1, own);
        if (!part) continue;
        // Its content in one box, at the end of the header's room or the start of the footer's.
        const el = doc.createElement("div");
        el.className = kind;
        const body = part.cloneNode(true) as HTMLElement;
        body.className = "ts-marginal";
        el.append(body);
        Object.assign(el.style, {
          position: "absolute",
          left: `${left + binding(i)}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${Math.max(0, h)}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: end ? "flex-end" : "flex-start",
        });
        // html-compat's page number (3999), in the numbering's symbols, becomes this page's.
        const n = info?.number ?? i + 1;
        const symbols = [...new Set(["1", info?.symbol ?? "1"])];
        const walker = doc.createTreeWalker(el, 4);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const text = t as Text;
          for (const symbol of symbols)
            text.data = text.data.replaceAll(formatNumber(PAGE_NUMBER, symbol), formatNumber(n, symbol));
        }
        marginals.append(el);
      }
    }
  };

  /** Top of sheet `i` in the flow's own px. */
  const sheetTop = (i: number): number =>
    (sheet(i).getBoundingClientRect().top - sheet(0).getBoundingClientRect().top) / scale;
  const pageHeight = () => (geometry.height ?? 0) * PX;

  // Page columns (`set page(columns: n)`): the flow, one column wide, is laid out in regions, a column each, one
  // under the other a page apart; region r is column r % n of page r / n, where its content is moved
  // (`placeRegions`) as Typst sets it there, the first filled before the next (no balancing).
  const columns = () => (geometry.height === null ? 1 : Math.max(1, geometry.columns ?? 1));
  const columnWidth = () => {
    const [, right, , left] = geometry.margin.map((m) => m * PX) as [number, number, number, number];
    const n = columns();
    return (pageWidth() - left - right - (n - 1) * (geometry.gutter ?? 0) * PX) / n;
  };
  /** Pages apart, in the flow's px: what the sheets are. */
  const pitch = () => {
    if (sheets.children.length > 1) return sheetTop(1);
    const gap = Number.parseFloat(view.getComputedStyle(sheets).rowGap) || 0;
    return (sheet(0).getBoundingClientRect().height + gap) / scale;
  };
  /** The sheet region `r` (a page, or a column of one) is on. */
  const sheetOf = (r: number) => Math.floor(r / columns());
  /** Where region `r` is laid out in the flow. */
  const regionTop = (r: number) => (columns() > 1 ? r * pitch() : sheetTop(r));
  /** Room a float across a page's columns takes at its top, by page: its columns start below it. */
  let floats: number[] = [];
  const contentTop = (i: number) =>
    regionTop(i) + geometry.margin[0] * PX + (i % columns() > 0 ? (floats[sheetOf(i)] ?? 0) : 0);
  const contentBottom = (i: number) => regionTop(i) + pageHeight() - geometry.margin[2] * PX;

  /** What was moved to its column: blocks (`translate`) and inline runs wrapped to move. */
  let regions: { el: HTMLElement; wrap: boolean }[] = [];
  const clearRegions = () => {
    for (const { el, wrap } of regions) {
      if (!wrap) {
        el.style.translate = "";
        continue;
      }
      const parent = el.parentNode;
      el.replaceWith(...el.childNodes);
      parent?.normalize();
    }
    regions = [];
    flow.style.height = "";
  };
  /**
   * Moves what is laid out in each region to its column on its page: the nodes between the room before the region
   * and the room before the next, the outermost wholly there. A block moves (`translate`, drawing only); inline
   * content, which can't, is wrapped in a span moved relative to its place.
   */
  /** How far the text moves on page `p` (even pages, with inside and outside margins). */
  const binding = (p: number) => (p % 2 === 1 ? (geometry.binding ?? 0) * PX : 0);
  const placeRegions = (starts: Node[]) => {
    const n = columns();
    if (n < 2 && !geometry.binding) return;
    const step = columnWidth() + (geometry.gutter ?? 0) * PX;
    const range = doc.createRange();
    const index = (node: Node) => Array.prototype.indexOf.call((node.parentNode as Node).childNodes, node) as number;
    for (const [r, start] of starts.entries()) {
      const region = r + 1;
      const dx = (region % n) * step + binding(sheetOf(region));
      const dy = n > 1 ? (sheetOf(region) - region) * pitch() : 0;
      if (!dx && !dy) continue;
      range.setStartBefore(start);
      const end = starts[r + 1];
      if (end) range.setEndBefore(end);
      else range.setEnd(flow, flow.childNodes.length);
      const move = (node: Node) => {
        if (node.nodeType === 3) {
          if (!(node as Text).data.trim()) return;
        } else if (node.nodeType !== 1) return;
        const el = node as HTMLElement;
        if (node.nodeType === 1) {
          const display = view.getComputedStyle(el).display;
          if (display === "contents") return walk(el);
          if (outOfFlow(el, view)) return;
          if (!display.startsWith("inline")) {
            el.style.translate = `${dx}px ${dy}px`;
            regions.push({ el, wrap: false });
            return;
          }
        }
        const wrap = doc.createElement("span");
        wrap.className = "typstream-region";
        wrap.style.cssText = `position:relative;left:${dx}px;top:${dy}px`;
        (node.parentNode as Node).insertBefore(wrap, node);
        wrap.append(node);
        regions.push({ el: wrap, wrap: true });
      };
      const walk = (parent: Node) => {
        for (const child of [...parent.childNodes]) {
          if (!range.intersectsNode(child)) continue;
          const i = index(child);
          const whole =
            range.comparePoint(child.parentNode as Node, i) >= 0 &&
            range.comparePoint(child.parentNode as Node, i + 1) <= 0;
          if (whole) move(child);
          else walk(child);
        }
      };
      walk(flow);
    }
    // The flow as tall as its pages: what was laid out further down shows moved up.
    if (n > 1) flow.style.height = `${count * pitch()}px`;
  };

  /** A rectangle's top and bottom in the flow's own px. */
  const origin = () => flow.getBoundingClientRect().top;
  const inFlow = (r: { top: number; bottom: number }, o: number) => ({
    top: (r.top - o) / scale,
    bottom: (r.bottom - o) / scale,
  });

  // --- gaps --------------------------------------------------------------------------

  /** A spacer before `node` (block-level when `block`, else a span that splits the line run it is in). */
  const spacerBefore = (node: Node, block: boolean): Gap => {
    const el = doc.createElement(block ? "div" : "span");
    el.className = SPACER;
    el.setAttribute("aria-hidden", "true");
    el.style.display = "block";
    el.style.height = "0px";
    (node.parentNode as Node).insertBefore(el, node);
    return {
      node: el,
      page: 0,
      // Less than nothing pulls what follows up: spacing that Typst drops at the top of a page.
      set: (px) => {
        el.style.height = `${Math.max(0, px)}px`;
        el.style.marginTop = px < 0 ? `${px}px` : "";
      },
      remove: () => {
        const parent = el.parentNode;
        el.remove();
        parent?.normalize();
      },
    };
  };

  /** Room above a grid row: a top margin on each of its cells. */
  const rowGap = (cells: HTMLElement[]): Gap => ({
    node: cells[0] as Node,
    page: 0,
    set: (px) => {
      for (const c of cells) c.style.marginTop = `${Math.max(0, px)}px`;
    },
    remove: () => {
      for (const c of cells) c.style.marginTop = "";
    },
  });

  // --- units -------------------------------------------------------------------------

  // --- footnotes ---------------------------------------------------------------------

  /** Typst's endnotes' entries by id, for the pass being laid out. */
  let entries = new Map<string, HTMLElement>();

  /** The entry a footnote reference links to. */
  const noteOf = (ref: Element): HTMLElement | undefined => {
    const href = ref.querySelector("a")?.getAttribute("href");
    return href?.startsWith("#") ? entries.get(href.slice(1)) : undefined;
  };

  /** The footnotes referenced in `els`, as a unit's `notes`. */
  const withNotes = (els: Element[]): Pick<Unit, "notes"> => {
    if (!entries.size) return {};
    const notes = els
      .flatMap((el) => [...(el.matches(NOTEREF) ? [el] : []), ...el.querySelectorAll(NOTEREF)])
      .map(noteOf)
      .filter((n): n is HTMLElement => !!n);
    return notes.length ? { notes } : {};
  };

  /** A unit for an element that doesn't break. */
  const whole = (el: Element, sticky?: Element): Unit => ({
    host: el,
    measure: () => inFlow(el.getBoundingClientRect(), origin()),
    gap: () => spacerBefore(el, true),
    ...(sticky ? { sticky } : {}),
    ...withNotes([el]),
    ...(el.classList.contains("ts-columns") ? { fit: fill(el as HTMLElement) } : {}),
  });

  /**
   * Typst's columns don't balance: the first fills the room left on the page before the next starts (typst-layout's
   * columns.rs), and they are as tall as the tallest. CSS columns given that height fill the same way; they are then
   * cut to what they hold. Columns that don't fit in the room keep CSS's balanced height and move to the next page.
   */
  const fill = (el: HTMLElement) => (room: number) => {
    el.style.columnFill = "auto";
    el.style.height = `${Math.max(0, room)}px`;
    const box = el.getBoundingClientRect();
    // What the columns hold, in their flow: its boxes, not what is placed out of it (the MathML that screen readers
    // read, which overflows its own box).
    const range = doc.createRange();
    const rects = [...el.childNodes]
      .flatMap((n) => {
        if (n.nodeType === 1) return outOfFlow(n as Element, view) ? [] : [...(n as Element).getClientRects()];
        range.selectNodeContents(n);
        return [...range.getClientRects()];
      })
      .filter((r) => r.width || r.height);
    if (rects.some((r) => r.right > box.right + 1)) {
      el.style.columnFill = el.style.height = "";
      return;
    }
    const bottom = Math.max(box.top, ...rects.map((r) => r.bottom));
    el.style.height = `${(bottom - box.top) / scale}px`;
  };

  /** Where the line at `top` starts in the inline run `nodes` (their first node or character on it). */
  const lineStart = (nodes: Node[], top: number, o: number): Node | { text: Text; offset: number } | null => {
    const range = doc.createRange();
    for (const node of nodes) {
      if (node.nodeType === 3) {
        const text = node as Text;
        const rects = (() => {
          range.selectNodeContents(text);
          return [...range.getClientRects()].map((r) => inFlow(r, o));
        })();
        if (!rects.some((r) => r.bottom > top + EPS)) continue;
        // The first character whose box is on or below the line.
        let lo = 0;
        let hi = text.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          range.setStart(text, mid);
          range.setEnd(text, mid + 1);
          const r = range.getClientRects()[0];
          if (r && inFlow(r, o).bottom > top + EPS) hi = mid;
          else lo = mid + 1;
        }
        // Whitespace that ends the line before belongs to it.
        while (lo < text.length && /\s/.test(text.data[lo] as string)) lo++;
        return lo >= text.length ? null : { text, offset: lo };
      }
      const el = node as Element;
      const rect = inFlow(el.getBoundingClientRect(), o);
      if (rect.bottom <= top + EPS) continue;
      if (el.matches(WHOLE) || view.getComputedStyle(el).display.startsWith("inline-")) return el;
      const inner = lineStart([...el.childNodes], top, o);
      if (inner) return inner;
    }
    return null;
  };

  /**
   * How far below its line's top a text's box is (flow px): the browser's box starts its rounded ascent above its
   * baseline, which the baseline correction (`data-baseline`) moves to Typst's, 1.054em below the line's top.
   */
  const textDrop = (text: Text): number => {
    const el = text.parentElement;
    if (!el || !baseline || baseline === "exact" || !el.closest(".typstream-t") || el.closest(".ts-edges")) return 0;
    const size = Number.parseFloat(view.getComputedStyle(el).fontSize);
    const descent = 0.246 * size;
    const borrow = root.dataset.baselineBorrow !== undefined && Math.round(descent) < descent ? 1 : 0;
    return 1.054 * size - Math.round(1.054 * size) + borrow;
  };
  /** A text's box (`r`, a client rect of it) as its line's, in the flow. */
  const textBox = (text: Text, r: DOMRect, o: number) => {
    const box = inFlow(r, o);
    const drop = textDrop(text);
    return { top: box.top - drop, bottom: box.bottom - drop };
  };

  /** The text nodes and inline atoms of an inline run, deep, with their boxes. */
  const boxes = (nodes: Node[], o: number, out: { top: number; bottom: number }[]): void => {
    const range = doc.createRange();
    for (const node of nodes) {
      if (node.nodeType === 3) {
        if (!(node as Text).data.trim()) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.height > 0) out.push(textBox(node as Text, r, o));
      } else if (node.nodeType === 1) {
        const el = node as Element;
        if ((el as HTMLElement).classList?.contains(SPACER) || outOfFlow(el, view)) continue;
        const display = view.getComputedStyle(el).display;
        if (el.matches(WHOLE) || display.startsWith("inline-")) {
          const r = el.getBoundingClientRect();
          if (r.height > 0) out.push(inFlow(r, o));
        } else boxes([...el.childNodes], o, out);
      }
    }
  };

  /** The lines of an inline run (the inline nodes between blocks of `parent`). */
  const lines = (nodes: Node[], o: number, sticky: Element | undefined, out: Unit[]): void => {
    const found: { top: number; bottom: number }[] = [];
    boxes(nodes, o, found);
    found.sort((a, b) => a.top - b.top);
    const merged: { top: number; bottom: number }[] = [];
    for (const r of found) {
      const last = merged[merged.length - 1];
      // On the same line when it overlaps the line's box by more than half its own height.
      if (last && Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top) > (r.bottom - r.top) / 2) {
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else merged.push({ ...r });
    }
    const units: Unit[] = [];
    /** The unit of each merged line (lines that don't start one have none). */
    const lineUnits: (Unit | undefined)[] = [];
    for (const [i, line] of merged.entries()) {
      const height = line.bottom - line.top;
      // The first line's gap goes before the run's first node; later ones at their first character.
      const start = i === 0 ? null : lineStart(nodes, line.top, o);
      if (i > 0 && !start) continue;
      const first = nodes[0] as Node;
      /** The top of the line's first box: a character, an element, or the run's first node. */
      const firstTop = (now: number): number => {
        const range = doc.createRange();
        if (start && "text" in start) {
          if (start.offset >= start.text.length) range.selectNode(start.text);
          else {
            range.setStart(start.text, start.offset);
            range.setEnd(start.text, start.offset + 1);
            const r = range.getClientRects()[0];
            return r
              ? textBox(start.text, r, now).top
              : inFlow((start.text.parentElement as Element).getBoundingClientRect(), now).top;
          }
        } else range.selectNode(start ?? first);
        const rects = [...range.getClientRects()].filter((r) => r.height > 0);
        return rects.length ? inFlow(rects[0] as DOMRect, now).top : line.top;
      };
      // The line's box can start above its first box (an equation further on is taller).
      const above = line.top - firstTop(o);
      const unit: Unit = {
        measure: () => {
          const top = firstTop(origin()) + above;
          return { top, bottom: top + height };
        },
        gap: () => {
          if (start && "text" in start) {
            const rest = start.offset > 0 ? start.text.splitText(start.offset) : start.text;
            // The line starts the text after the split now.
            start.text = rest;
            start.offset = 0;
            return spacerBefore(rest, false);
          }
          // A paragraph's first line: room before the paragraph (and what it starts), where its own indent stays.
          if (!start) return spacerBefore(opening(first), true);
          return spacerBefore(start, false);
        },
        ...(sticky ? { sticky } : {}),
        host: first,
      };
      units.push(unit);
      lineUnits[i] = unit;
    }
    for (const [index, unit] of units.entries()) unit.par = { index, lines: units };
    // Each footnote reference goes with the line it is on.
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      for (const ref of [...(el.matches(NOTEREF) ? [el] : []), ...el.querySelectorAll(NOTEREF)]) {
        const note = noteOf(ref);
        if (!note) continue;
        const r = inFlow(ref.getBoundingClientRect(), o);
        const middle = (r.top + r.bottom) / 2;
        const line = merged.findIndex((l) => middle >= l.top - EPS && middle <= l.bottom + EPS);
        const unit = lineUnits[line] ?? units[units.length - 1];
        if (unit) unit.notes = [...(unit.notes ?? []), note];
      }
    }
    out.push(...units);
  };

  /**
   * The outermost block that `node` starts: room before it moves the block, not just its first line. Not past a
   * grid's or flex box's item, before which room would be an item of its own.
   */
  const opening = (node: Node): Node => {
    let at = node;
    for (;;) {
      const parent = at.parentElement;
      if (!parent || parent === flow) return at;
      const display = view.getComputedStyle(parent).display;
      if (/grid|flex|contents|inline|table/.test(display) || parent.matches(".ts-cell, .ts-item-body")) return at;
      let prev = at.previousSibling;
      while (prev && prev.nodeType === 3 && !(prev as Text).data.trim()) prev = prev.previousSibling;
      if (prev) return at;
      at = parent;
    }
  };

  /** The units of a grid's rows; a row of a table, or of a block that doesn't break, is one. */
  /**
   * Room above a table's row that starts a page, with its header repeated in it as Typst repeats a `table.header`:
   * copies of the header's cells (`aria-hidden`), placed in the row's track above it.
   */
  const headerGap = (cells: HTMLElement[], header: HTMLElement[], repeat: { height: number }): Gap => {
    const tops = header.map((c) => c.getBoundingClientRect().top);
    const top = Math.min(...tops);
    const height = (Math.max(...header.map((c) => c.getBoundingClientRect().bottom)) - top) / scale;
    const row = view.getComputedStyle(cells[0] as HTMLElement).gridRowStart;
    let copies: HTMLElement[] = [];
    const clear = () => {
      for (const c of copies) c.remove();
      copies = [];
    };
    return {
      node: cells[0] as Node,
      page: 0,
      set: (px) => {
        const room = Math.max(0, px);
        repeat.height = height;
        for (const c of cells) c.style.marginTop = `${room + height}px`;
        clear();
        copies = header.map((cell, i) => {
          const copy = cell.cloneNode(true) as HTMLElement;
          copy.setAttribute("aria-hidden", "true");
          copy.removeAttribute("role");
          for (const el of [copy, ...copy.querySelectorAll("[id]")]) el.removeAttribute("id");
          Object.assign(copy.style, {
            position: "absolute",
            gridRow: row,
            top: `${room + ((tops[i] as number) - top) / scale}px`,
            left: "0",
            right: "0",
            height: `${cell.offsetHeight}px`,
            margin: "0",
          });
          (cell.parentNode as Node).appendChild(copy);
          return copy;
        });
      },
      remove: () => {
        repeat.height = 0;
        for (const c of cells) c.style.marginTop = "";
        clear();
      },
    };
  };

  const gridRows = (grid: Element, o: number, out: Unit[]): void => {
    const cells = [...grid.querySelectorAll<HTMLElement>(":scope > .ts-cell, :scope > .ts-row > .ts-cell")];
    const rows = new Map<number, HTMLElement[]>();
    for (const cell of cells) {
      const row = Number.parseInt(view.getComputedStyle(cell).gridRowStart, 10) || 0;
      rows.set(row, [...(rows.get(row) ?? []), cell]);
    }
    const breakable = !grid.classList.contains("ts-table") && !grid.closest(".ts-whole");
    // A table's header: its first rows, all header cells (html-compat's `.ts-head`). It goes with the first row after
    // it to the next page, and comes again above a row that starts one.
    const order = [...rows.keys()].sort((a, b) => a - b);
    let heads = 0;
    while (
      heads < order.length &&
      (rows.get(order[heads] as number) as HTMLElement[]).every((c) => c.matches(".ts-head"))
    )
      heads++;
    if (heads === order.length) heads = 0;
    const header = order.slice(0, heads).flatMap((r) => rows.get(r) as HTMLElement[]);
    if (header.length) (grid as HTMLElement).style.position ||= "relative";
    for (const [index, row] of order.entries()) {
      const these = rows.get(row) as HTMLElement[];
      // While the header is repeated above it, the row starts at the copies' top.
      const repeat = { height: 0 };
      const measure = () => {
        const now = origin();
        const rects = these.map((c) => inFlow(c.getBoundingClientRect(), now));
        return {
          top: Math.min(...rects.map((r) => r.top)) - repeat.height,
          bottom: Math.max(...rects.map((r) => r.bottom)),
        };
      };
      const first: Unit = {
        measure,
        gap: () => (index > heads && heads > 0 ? headerGap(these, header, repeat) : rowGap(these)),
        ...(index < heads ? { sticky: grid } : {}),
        ...withNotes(these),
        host: grid,
      };
      if (!breakable) {
        out.push(first);
        continue;
      }
      // A breakable row breaks inside its tallest cell; a break before its first line moves the whole row.
      const tallest = these.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
      const inner: Unit[] = [];
      collect(tallest, o, inner);
      if (inner.length <= 1) {
        out.push(first);
        continue;
      }
      // Its first unit's room goes above the whole row.
      const head: Unit = { ...(inner[0] as Unit), gap: first.gap };
      if (head.par) head.par.lines[head.par.index] = head;
      out.push(head, ...inner.slice(1));
    }
  };

  /** The units in `el`'s content, in order (from its child `start` on). */
  const collect = (el: Element, o: number, out: Unit[], sticky?: Element, start?: Node): void => {
    let run: Node[] = [];
    const flush = () => {
      if (run.some((n) => n.nodeType === 1 || (n as Text).data.trim())) lines(run, o, sticky, out);
      run = [];
    };
    let force: boolean | "weak" | "column" = false;
    let pageRun: string | null = null;
    const nodes = [...el.childNodes];
    for (const node of start ? nodes.slice(Math.max(0, nodes.indexOf(start as ChildNode))) : nodes) {
      if (node.nodeType === 3) {
        run.push(node);
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as HTMLElement;
      if (child.classList.contains(SPACER)) continue;
      if (outOfFlow(child, view)) continue;
      if (!isBlock(child, view) && view.getComputedStyle(child).display !== "contents") {
        run.push(child);
        continue;
      }
      flush();
      const before = out.length;
      // Spacing after a page break starts the next page. Elsewhere Typst drops it where a page ends.
      if (
        force &&
        child.classList.contains("ts-v") &&
        !child.classList.contains("ts-v-weak") &&
        !child.classList.contains("ts-vfill")
      ) {
        out.push({ ...whole(child), force });
        force = false;
        continue;
      }
      if (child.classList.contains("ts-vfill")) {
        out.push({
          measure: () => inFlow(child.getBoundingClientRect(), origin()),
          gap: () => spacerBefore(child, true),
          fr: child,
        });
        continue;
      }
      // A page's settings changing (`set page(..)`): Typst starts a page with them.
      if (el === flow && child.dataset.typstreamPage !== undefined) {
        const key = runKey(child);
        if (pageRun !== null && key !== pageRun && !force) force = true;
        pageRun = key;
      }
      // A column break between the page's columns (`set page(columns: n)`).
      if (el === flow && columns() > 1 && child.classList.contains("ts-colbreak")) {
        force = force === true ? true : "column";
        continue;
      }
      if (child.classList.contains("ts-pagebreak")) {
        force = force === true || !child.classList.contains("ts-pagebreak-weak") ? true : "weak";
        continue;
      }
      const stick = sticky ?? (child.matches(STICKY) ? child : undefined);
      if (view.getComputedStyle(child).display === "contents") collect(child, o, out, stick);
      else if (child.matches(WHOLE)) out.push(whole(child, stick));
      else if (child.classList.contains("ts-grid") && !child.classList.contains("ts-list")) gridRows(child, o, out);
      else if (child.classList.contains("ts-list"))
        for (const body of child.querySelectorAll<HTMLElement>(":scope > li > .ts-item-body")) collect(body, o, out);
      else collect(child, o, out, stick);
      if (force && out.length > before) {
        (out[before] as Unit).force = force;
        force = false;
      }
      // Typst aligns a block of the page's flow in the room the page's content leaves (typst-layout's flow,
      // distribute.rs and the ruler in compose.rs).
      if (el === flow && child.classList.contains("ts-align-v") && out.length > before) {
        const y = (child as HTMLElement).style.justifyContent;
        (out[before] as Unit).align = { el: child, at: y === "center" ? 0.5 : 1 };
      }
    }
    flush();
  };

  // --- boxes broken across pages ------------------------------------------------------

  /**
   * The boxes (blocks with an inset: html-compat's padding) around `node`, innermost first. Typst insets each piece of
   * a box broken across pages (typst-layout's block, its frames per region): a line goes on a page only if the
   * boxes' bottom insets fit under it, and the piece on the next page starts below their top insets.
   */
  const boxesAround = (node: Node | undefined): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (let at = node?.parentElement; at && at !== flow; at = at.parentElement) {
      const style = view.getComputedStyle(at);
      if (style.display.startsWith("inline") || style.display === "contents") continue;
      if (Number.parseFloat(style.paddingTop) || Number.parseFloat(style.paddingBottom)) out.push(at);
    }
    return out;
  };
  const inset = (el: HTMLElement, side: "Top" | "Bottom") =>
    Number.parseFloat(view.getComputedStyle(el)[`padding${side}`]) || 0;
  /** The insets of the boxes around a unit, below it: room it leaves at a page's end. */
  const insetBelow = (unit: Unit) =>
    unit.host && unit.host !== flow ? boxesAround(unit.host).reduce((sum, b) => sum + inset(b, "Bottom"), 0) : 0;

  /** Boxes broken across pages: where each break is (the spacer before it, the page it starts, the insets ending it). */
  let splits = new Map<HTMLElement, { at: number; page: number; spacer: Node }[]>();

  /**
   * Draws each broken box as its pieces, as Typst draws one per page: the box itself draws nothing
   * (`.typstream-split`) and is clipped to its pieces, so nothing of it shows between the pages, and each piece
   * (`.typstream-piece`) is a box of the same fill, corners and stroke behind its content.
   */
  const drawSplits = () => {
    underlay.replaceChildren();
    // Outer boxes first, under the inner ones.
    const boxes = [...splits].sort(([a], [b]) => (a.contains(b) ? -1 : b.contains(a) ? 1 : 0));
    for (const [box, cuts] of boxes) {
      const o = origin();
      const rect = box.getBoundingClientRect();
      const top = inFlow(rect, o).top;
      const left = (rect.left - flow.getBoundingClientRect().left) / scale;
      const height = rect.height / scale;
      const width = rect.width / scale;
      // Where each piece starts and ends, in the box.
      const pieces: [number, number][] = [];
      let from = 0;
      for (const cut of cuts) {
        const end = inFlow((cut.spacer as Element).getBoundingClientRect(), o).top - top + cut.at;
        pieces.push([from, end]);
        from = contentTop(cut.page) - top;
      }
      pieces.push([from, height]);
      const style = view.getComputedStyle(box);
      for (const [start, end] of pieces) {
        const piece = doc.createElement("div");
        piece.className = `typstream-piece${box.classList.contains("ts-stroked") ? " ts-stroked" : ""}`;
        piece.setAttribute("aria-hidden", "true");
        Object.assign(piece.style, {
          top: `${top + start}px`,
          left: `${left}px`,
          width: `${width}px`,
          height: `${Math.max(0, end - start)}px`,
          background: style.background,
          borderRadius: style.borderRadius,
        });
        for (const k of ["bt", "br", "bb", "bl", "wt", "wr", "wb", "wl"]) {
          const v = style.getPropertyValue(`--ts-${k}`);
          if (v) piece.style.setProperty(`--ts-${k}`, v);
        }
        underlay.append(piece);
      }
      // Nothing of the box between its pieces: a comb of them, joined along its left edge.
      const [x0, x1] = [-20, width + 20];
      const points = [`${x0}px -20px`, `${x1}px -20px`];
      for (const [i, [, end]] of pieces.slice(0, -1).entries()) {
        const next = (pieces[i + 1] as [number, number])[0];
        points.push(`${x1}px ${end}px`, `${x0}px ${end}px`, `${x0}px ${next}px`, `${x1}px ${next}px`);
      }
      points.push(`${x1}px ${height + 20}px`, `${x0}px ${height + 20}px`);
      box.style.clipPath = `polygon(${points.join(", ")})`;
      box.classList.add("typstream-split");
    }
  };
  const clearSplits = () => {
    for (const box of splits.keys()) {
      box.classList.remove("typstream-split");
      box.style.clipPath = "";
    }
    underlay.replaceChildren();
    splits = new Map();
  };

  // --- breaking ----------------------------------------------------------------------

  const clear = () => {
    clearRegions();
    for (const gap of [...gaps, ...shifts]) gap.remove();
    gaps = [];
    shifts = [];
    clearSplits();
  };

  /** The unit to move to the next page when `units[i]` doesn't fit: Typst keeps orphans, widows and sticky blocks. */
  const breakAt = (units: Unit[], i: number, top: number): number => {
    let j = i;
    const unit = units[j] as Unit;
    const par = unit.par;
    if (par && par.lines.length >= 2) {
      const n = par.lines.length;
      // Two lines at the start (orphans), two at the end (widows), all three of three.
      const index =
        par.index === 1 || (n === 3 && par.index === 2) ? 0 : par.index === n - 1 && n >= 3 ? n - 2 : par.index;
      j = units.indexOf(par.lines[index] as Unit);
    }
    // A sticky block goes with its first line onto the next page, unless it heads this one.
    const prev = units[j - 1];
    if (prev?.sticky && prev.sticky !== units[j]?.sticky) {
      let k = j - 1;
      while (k > 0 && (units[k - 1] as Unit).sticky === prev.sticky) k--;
      if ((units[k] as Unit).measure().top > top + EPS) j = k;
    }
    // Nothing to gain from moving what already heads the page.
    return j < i && (units[j] as Unit).measure().top <= top + EPS ? i : j;
  };

  /** What the pages were last laid out for: a change lays them all out again. */
  let laidOut = "";

  /** The child of the flow that holds `node`; a break between blocks belongs to the block after it. */
  const topOf = (node: Node): Node | null => {
    let at: Node | null = node;
    while (at && at.parentNode !== flow) at = at.parentNode;
    while (at && (at as Element).classList?.contains(SPACER)) at = at.nextSibling;
    return at;
  };

  /**
   * Fractional spacing alone in its run of text (the renderer's `.typstream-fill`) takes what its line leaves, as
   * Typst's does: nothing while lines break, then the rest of the line it is on.
   */
  const fillLines = (root: HTMLElement) => {
    const fills = [...root.querySelectorAll<HTMLElement>(".typstream-fill > .ts-hfill")];
    for (const h of fills) h.style.width = "0px";
    const range = doc.createRange();
    const widths = fills.map((h) => {
      const row = h.parentElement as HTMLElement;
      // The baseline of its line (it is an empty inline block there): what follows on that line crosses it.
      const at = h.getBoundingClientRect().top;
      let right = h.getBoundingClientRect().right;
      for (let node = h.nextSibling; node; node = node.nextSibling) {
        let rects: DOMRectList;
        if (node.nodeType === 1) rects = (node as Element).getClientRects();
        else {
          range.selectNodeContents(node);
          rects = range.getClientRects();
        }
        for (const r of rects)
          if (r.width && r.top <= at + EPS && r.bottom >= at - EPS) right = Math.max(right, r.right);
      }
      // A quarter of a pixel short: a line exactly full can break in layouts that round (Firefox's).
      return (row.getBoundingClientRect().right - right) / scale - 0.25;
    });
    fills.forEach((h, i) => {
      h.style.width = `${Math.max(0, widths[i] as number)}px`;
    });
  };

  /**
   * Footnotes go at the foot of the page their reference is on, as Typst sets them (typst-layout's flow and
   * `footnote.entry`'s defaults): 1em of room, a separator 30% of the text's width, then each entry 0.5em below what
   * is above it, indented by 1em of its text. Typst's HTML writes them at the end of the document; that section stays
   * there for screen readers, out of sight, and the pages show copies of its entries.
   */
  let pageNotes: HTMLElement[][] = [];
  let noteHeights = new Map<HTMLElement, number>();
  /** The flow's `em` (px), which footnotes' room and gaps are in. */
  const em = () => Number.parseFloat(view.getComputedStyle(flow).fontSize) || 14.67;
  const noteEntry = (li: HTMLElement): HTMLElement => {
    const entry = doc.createElement("div");
    entry.className = "typstream-footnote";
    entry.style.paddingInlineStart = view.getComputedStyle(li.querySelector(".typstream-t") ?? li).fontSize;
    for (const child of li.childNodes) entry.append(child.cloneNode(true));
    for (const el of entry.querySelectorAll("[id]")) el.removeAttribute("id");
    return entry;
  };
  /** The room footnotes take at the foot of `page`, with `more` added to them. */
  const noteRoom = (page: number, more: readonly HTMLElement[] = []): number => {
    const notes = [...(pageNotes[page] ?? []), ...more];
    if (!notes.length) return 0;
    return em() + notes.reduce((sum, li) => sum + em() / 2 + (noteHeights.get(li) ?? 0), 0);
  };
  /** Where the page's content ends: above its footnotes. */
  const contentEnd = (page: number) => contentBottom(page) - noteRoom(page);
  const drawNotes = () => {
    const left = geometry.margin[3] * PX;
    const width = pageWidth() - left - geometry.margin[1] * PX;
    for (const [page, notes] of pageNotes.entries()) {
      if (!notes?.length) continue;
      const box = doc.createElement("div");
      box.className = "typstream-footnotes";
      Object.assign(box.style, {
        position: "absolute",
        left: `${left + binding(sheetOf(page))}px`,
        width: `${width}px`,
        top: `${contentEnd(page) + em()}px`,
      });
      // The separator's stroke centred on its line, as Typst draws it.
      const separator = doc.createElement("div");
      Object.assign(separator.style, { position: "absolute", top: "-0.25pt", width: "30%", borderTop: "0.5pt solid" });
      box.append(separator);
      for (const li of notes) {
        const entry = noteEntry(li);
        entry.style.marginTop = `${em() / 2}px`;
        box.append(entry);
      }
      marginals.append(box);
    }
  };

  /**
   * Where the browser puts text's baseline in a line 1.3em tall, which Typst puts 1.054em below its top: WebKit
   * there, Firefox after rounding the font's ascent and descent to pixels (`round`), Chromium after flooring the
   * half-leading too (`floor`). Found once, on the engine's font, and written on the root (`data-baseline`): the
   * pages' CSS moves text by the difference, which `round()` computes (only how it is drawn, not its line).
   */
  let baseline = "";
  let loading = false;
  const findBaseline = () => {
    if (baseline) return;
    const font = "8pt typstream-libertinus-serif";
    if (!doc.fonts.check(font)) {
      // Loaded for this (a document may have no text in it), then laid out again.
      if (!loading)
        doc.fonts.load(font).then(
          () => layoutSoon(),
          () => {},
        );
      loading = true;
      return;
    }
    /** Where the baseline of a line of text `pt` big is, from its top. */
    const measure = (pt: number) => {
      const probe = doc.createElement("div");
      probe.style.cssText = `position:absolute;visibility:hidden;line-height:0;font-family:typstream-libertinus-serif;font-size:${pt}pt`;
      // (Built, not parsed: a page may require Trusted Types for innerHTML.)
      const text = doc.createElement("span");
      text.style.lineHeight = "1.3";
      const mark = doc.createElement("span");
      mark.style.cssText = "display:inline-block;width:0;height:0";
      text.append("Hx", mark);
      probe.append(text);
      underlay.append(probe);
      const top = probe.getBoundingClientRect().top;
      const at = (mark.getBoundingClientRect().bottom - top) / scale;
      probe.remove();
      return at;
    };
    const expect = (rule: string, pt: number) => {
      const size = (pt * 4) / 3;
      const [ascent, descent] = [Math.round(1.054 * size), Math.round(0.246 * size)];
      const half = (1.3 * size - ascent - descent) / 2;
      return rule === "floor" ? Math.floor(half) + ascent : rule === "round" ? half + ascent : 1.054 * size;
    };
    const at = measure(8);
    const found = ["floor", "round"].find(
      (rule) => Math.abs(expect(rule, 8) - at) < 0.05 && Math.abs(expect(rule, 8) - expect("exact", 8)) > 0.05,
    );
    baseline = found ?? "exact";
    // Chrome on Linux rounds a descent that it rounds down up instead, a pixel taken from the ascent (Blink's
    // AscentDescentWithHacks): at 13.2pt (17.6px) the descent, 4.33px, would be 4.
    if (baseline !== "exact" && Math.abs(expect(baseline, 13.2) - 1 - measure(13.2)) < 0.05)
      root.dataset.baselineBorrow = "";
    else delete root.dataset.baselineBorrow;
    root.dataset.baseline = baseline;
  };

  /**
   * Text in more than one size on a line: the browser puts the line's baseline where its largest text's rounded
   * ascent does, so each text's own baseline correction (`--ts-x`, made for its size) misses for the smaller ones,
   * which take the largest's. Only in blocks html-compat sized text in.
   */
  const alignMixedLines = () => {
    for (const el of flow.querySelectorAll<HTMLElement>('.typstream-t[style*="--ts-x"]'))
      el.style.removeProperty("--ts-x");
    if (!baseline || baseline === "exact") return;
    // Each block's inline sizes: one, its own, is text in one size (html-compat writes a paragraph's size on it too).
    const sized = new Map<HTMLElement, Set<string>>();
    for (const el of flow.querySelectorAll<HTMLElement>('span[style*="font-size"]')) {
      let block = el.parentElement;
      while (block && block !== flow && !isBlock(block, view)) block = block.parentElement;
      if (!block || block === flow) continue;
      const sizes = sized.get(block) ?? new Set([block.style.fontSize]);
      sized.set(block, sizes.add(el.style.fontSize));
    }
    for (const [block, sizes] of sized) {
      if (sizes.size < 2) continue;
      const texts = [...block.querySelectorAll<HTMLElement>(".typstream-t")].map((el) => {
        const style = view.getComputedStyle(el);
        const size = Number.parseFloat(style.fontSize);
        const shift = Number.parseFloat(style.top) || 0;
        const r = el.getClientRects()[0];
        // The browser's baseline, near enough to tell lines apart: below the box by its descent, without the shift.
        const at = r ? r.bottom / scale - shift - Math.round(0.246 * size) : Number.NaN;
        return { el, size, shift, at };
      });
      if (new Set(texts.map((t) => t.size)).size < 2) continue;
      const lines: (typeof texts)[] = [];
      for (const t of texts) {
        if (Number.isNaN(t.at)) continue;
        const line = lines.find((l) => Math.abs((l[0] as (typeof texts)[number]).at - t.at) < 2);
        if (line) line.push(t);
        else lines.push([t]);
      }
      for (const line of lines) {
        const largest = line.reduce((a, b) => (b.size > a.size ? b : a));
        for (const t of line) if (t.size < largest.size) t.el.style.setProperty("--ts-x", `${largest.shift}px`);
      }
    }
  };

  const paginate = (from: Node | null) => {
    place();
    findBaseline();
    alignMixedLines();
    collapseSpacing(flow, view, scale);
    fillLines(flow);
    // Footnotes: Typst's endnotes out of sight, their entries measured as the pages will show them.
    const endnotes = flow.querySelector<HTMLElement>(`:scope > ${ENDNOTES}`);
    entries = new Map(
      geometry.height === null || !endnotes
        ? []
        : [...endnotes.querySelectorAll<HTMLElement>("li[id]")].map((li) => [li.id, li] as const),
    );
    pageNotes = [];
    noteHeights = new Map();
    floats = [];
    if (endnotes) endnotes.classList.toggle("typstream-endnotes", entries.size > 0);
    if (entries.size) {
      const probe = doc.createElement("div");
      Object.assign(probe.style, {
        position: "absolute",
        visibility: "hidden",
        width: `${pageWidth() - (geometry.margin[1] + geometry.margin[3]) * PX}px`,
      });
      const measured = [...entries.values()].map((li) => [li, probe.appendChild(noteEntry(li))] as const);
      marginals.append(probe);
      for (const [li, entry] of measured) noteHeights.set(li, entry.offsetHeight);
      probe.remove();
    }
    const key = JSON.stringify([geometry, pageWidth(), scale]);
    if (
      key !== laidOut ||
      geometry.height === null ||
      shifts.length ||
      entries.size ||
      splits.size ||
      columns() > 1 ||
      geometry.binding ||
      runKeys().size > 1
    )
      from = null;
    laidOut = key;
    if (geometry.height === null) {
      // One page, as tall as the content.
      clear();
      sheet(0);
      while (sheets.children.length > 1) sheets.lastElementChild?.remove();
      count = 1;
      sheet(0).style.height = `${flow.offsetHeight * scale}px`;
      return;
    }
    sheet(0).style.height = "";
    // Pages before the change stay: the gaps before the block it is in, and the pages they start.
    let page = 0;
    let start: Node | undefined;
    const top = from ? topOf(from) : null;
    if (top) {
      const kept = gaps.filter((gap) => {
        const at = topOf(gap.node);
        return at && at !== top && at.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING;
      });
      for (const gap of gaps) if (!kept.includes(gap)) gap.remove();
      gaps = kept;
      const last = kept[kept.length - 1];
      page = last?.page ?? 0;
      start = (last && topOf(last.node)) || undefined;
      // A block that came before the kept ones' (the page's first) has nothing to measure past them.
      if (start && start !== top && !(start.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING))
        start = undefined;
    } else clear();
    const units: Unit[] = [];
    collect(flow, origin(), units, undefined, start);
    // Spacing above the first block collapses through to the top of the flow; Typst drops it.
    const head = units[0];
    const first = [...flow.children].find((c) => !c.classList.contains(SPACER));
    // Not spacing itself (a `v` that starts the document): Typst keeps that.
    const spacing = first?.matches(".ts-v:not(.ts-v-weak)");
    if (!start && head && first && !spacing && !head.force && head.measure().top > contentTop(0) + EPS) {
      const gap = spacerBefore(first, true);
      gaps.push(gap);
      gap.set(contentTop(0) - head.measure().top);
    }
    /** The fractional spacing and aligned blocks on the page being laid out. */
    let fills: { index: number; el: HTMLElement }[] = [];
    let aligns: { index: number; el: Element; at: number }[] = [];
    /**
     * Gives the room the page's content leaves (the units before `end` being on it) to its fractional spacing, or
     * else before its aligned blocks: the first in the middle moves down by half, the first at the end by the rest.
     */
    const fill = (end: number) => {
      const mine = fills.filter((f) => f.index < end);
      fills = fills.filter((f) => f.index >= end);
      const aligned = aligns.filter((a) => a.index < end);
      aligns = aligns.filter((a) => a.index >= end);
      if (!mine.length && !aligned.length) return;
      let last = end - 1;
      while (last >= 0 && (units[last] as Unit).fr) last--;
      const bottom = Math.max(contentTop(page), last >= 0 ? (units[last] as Unit).measure().bottom : 0);
      const grow = (el: HTMLElement) => Number(el.style.flexGrow) || 1;
      const total = mine.reduce((sum, f) => sum + grow(f.el), 0);
      const room = Math.max(0, contentEnd(page) - bottom);
      for (const f of mine) f.el.style.height = `${(room * grow(f.el)) / total}px`;
      if (mine.length) return;
      let ruler = 0;
      for (const a of aligned) {
        if (a.at <= ruler) continue;
        // The spacer stops the block's own spacing from collapsing away at the top of the page: without it.
        const top = a.el.getBoundingClientRect().top;
        const gap = spacerBefore(a.el, true);
        gap.set(room * (a.at - ruler) - (a.el.getBoundingClientRect().top - top) / scale);
        shifts.push(gap);
        ruler = a.at;
      }
    };
    for (let i = 0; i < units.length; i++) {
      const unit = units[i] as Unit;
      let { top, bottom } = unit.measure();
      // On a page kept as it was (the lines of a block before its break).
      if (start && top < contentTop(page) - EPS) continue;
      if (unit.fr) {
        unit.fr.style.height = "0px";
        fills.push({ index: i, el: unit.fr });
        continue;
      }
      if (unit.align) aligns.push({ index: i, ...unit.align });
      // A float across the page's columns: as wide as their text, the next columns starting below it.
      const float = unit.host as HTMLElement | undefined;
      if (columns() > 1 && float?.classList?.contains("ts-float-parent")) {
        const below = Number.parseFloat(view.getComputedStyle(float).marginBottom) || 0;
        floats[sheetOf(page)] = bottom + below - contentTop(page);
      }
      // A weak break where the page has nothing above yet is no break.
      if (unit.force === "weak" && top <= contentTop(page) + EPS) continue;
      if (unit.fit && !unit.force) {
        unit.fit(contentEnd(page) - top);
        ({ top, bottom } = unit.measure());
      }
      if (unit.force) {
        fill(i);
        // A page break goes to the next page's first column, a column break to the next column.
        page = unit.force === "column" ? page + 1 : (sheetOf(page) + 1) * columns();
        sheet(sheetOf(page));
        place();
      } else if (
        bottom + insetBelow(unit) <= contentBottom(page) - noteRoom(page, unit.notes) + EPS ||
        top <= contentTop(page) + EPS
      ) {
        if (unit.notes) pageNotes[page] = [...(pageNotes[page] ?? []), ...unit.notes];
        continue;
      } else {
        const j = breakAt(units, i, contentTop(page));
        // Footnotes of what moves go with it.
        const moving = new Set(units.slice(j, i).flatMap((u) => u.notes ?? []));
        if (moving.size) pageNotes[page] = (pageNotes[page] ?? []).filter((li) => !moving.has(li));
        fill(j);
        page++;
        sheet(sheetOf(page));
        place();
        i = j;
      }
      const moved = units[i] as Unit;
      const gap = moved.gap();
      gap.page = page;
      gaps.push(gap);
      // Measured with some room already: margins stop collapsing across a spacer once it has height.
      gap.set(1);
      ({ top, bottom } = moved.measure());
      // Room before a block that the unit opens: the block (its inset, its stroke) starts the page, not its line.
      const opened = (gap.node as Element).classList?.contains(SPACER)
        ? (gap.node as Element).nextElementSibling
        : null;
      if (opened) top = inFlow(opened.getBoundingClientRect(), origin()).top;
      // The boxes this breaks (begun on a page before): their pieces here start with their top insets, and the
      // pieces before end with their bottom insets after what is above the break.
      const broken = boxesAround(gap.node).filter((b) => inFlow(b.getBoundingClientRect(), origin()).top < top - EPS);
      for (const [i, b] of broken.entries()) {
        const below = broken.slice(0, i + 1).reduce((sum, x) => sum + inset(x, "Bottom"), 0);
        splits.set(b, [...(splits.get(b) ?? []), { at: below, page, spacer: gap.node }]);
      }
      gap.set(1 + contentTop(page) - top + broken.reduce((sum, b) => sum + inset(b, "Top"), 0));
      moved.fit?.(contentEnd(page) - contentTop(page));
      if (moved.notes) pageNotes[page] = [...(pageNotes[page] ?? []), ...moved.notes];
    }
    fill(units.length);
    // A layout from where the document changed that left its end past the last page's (a break before it missed):
    // all of it again.
    const end = units[units.length - 1]?.measure();
    if (start && end && end.bottom > contentEnd(page) + EPS && end.top > contentTop(page) + EPS) return paginate(null);
    count = sheetOf(page) + 1;
    while (sheets.children.length > count) sheets.lastElementChild?.remove();
    placeRegions(
      gaps
        .filter((g) => g.page > 0)
        .sort((a, b) => a.page - b.page)
        .map((g) => g.node),
    );
    drawSplits();
    numberPages();
    drawMarginals();
    drawNotes();
    fillLines(marginals);
    numberOutline();
    if (count !== told) {
      told = count;
      onCount?.(count);
    }
  };
  /** The page count `onCount` was last given. */
  let told = 1;

  /** The page of each outline entry's target (html-compat's `.ts-outline-page`), now that the pages are known. */
  const numberOutline = () => {
    const tops = [...Array(count).keys()].map(sheetTop);
    for (const span of flow.querySelectorAll(".ts-outline-page")) {
      const href = span.closest("a")?.getAttribute("href");
      // In this document: another on the page can have the same ids.
      const target = href?.startsWith("#")
        ? flow.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)
        : null;
      if (!target) continue;
      const top = inFlow(startOf(target).getBoundingClientRect(), origin()).top;
      let page = 0;
      while (page + 1 < tops.length && (tops[page + 1] as number) <= top + EPS) page++;
      const info = pageInfo[page];
      span.textContent = info ? formatNumber(info.number, info.symbol) : String(page + 1);
    }
  };

  // A first sheet right away: the element has a page's height before the first layout.
  sheet(0);
  place();

  let frame = 0;
  /** Where the next layout starts: `null` lays every page out. */
  let pending: Node | null | undefined;
  const layoutSoon = (from: Node | null = null) => {
    // The earlier of two changes; any whole layout wins.
    if (pending === undefined) pending = from;
    else if (pending && from && !(pending.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING))
      pending = from;
    else if (!from) pending = null;
    if (frame) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      const start = pending ?? null;
      pending = undefined;
      paginate(start && flow.contains(start) ? start : null);
    });
  };
  // Only the width matters: the sheets the layout adds change the height.
  let width = -1;
  const resized = new view.ResizeObserver(() => {
    if (root.clientWidth === width) return;
    width = root.clientWidth;
    layoutSoon();
  });
  resized.observe(root);
  // Fonts that arrive change the lines: the engine's are registered to load on first use.
  const fontsLoaded = () => layoutSoon();
  doc.fonts.addEventListener("loadingdone", fontsLoaded);

  return {
    flow,
    setGeometry(next) {
      if (JSON.stringify(next) === JSON.stringify(geometry)) return;
      geometry = next;
      layoutSoon();
    },
    setMarginals(nodes) {
      const key = nodes.map((n) => (n.nodeType === 1 ? (n as Element).outerHTML : n.textContent)).join("");
      if (key === partsKey) return;
      partsKey = key;
      parts = nodes;
      layoutSoon();
    },
    layout: (from) => layoutSoon(from ?? null),
    get count() {
      return count;
    },
    dispose() {
      if (frame) view.cancelAnimationFrame(frame);
      resized.disconnect();
      doc.fonts.removeEventListener("loadingdone", fontsLoaded);
      clear();
      sheets.remove();
      flow.remove();
      marginals.remove();
      underlay.remove();
      root.classList.remove("typstream-pages");
      delete root.dataset.baseline;
    },
  };
};
