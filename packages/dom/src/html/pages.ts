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

/** html-compat's `data-page`: `width height top right bottom left fill ascent descent`. */
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
  force?: boolean | "weak";
}

const SPACER = "typstream-break";
/** What html-compat writes for the page number in headers and footers. */
const PAGE_NUMBER = "7777";

/** Elements that don't break across pages. */
const WHOLE =
  ".ts-whole, figure, img, svg, math, typstream-island, .ts-frame, .ts-shape, .ts-line, .ts-columns, pre, .typstream-island";
/** Sticky blocks: they move to the next page with what follows them. */
const STICKY = "h1, h2, h3, h4, h5, h6, .ts-sticky";

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
  root.append(sheets, flow, marginals);
  let parts: readonly Node[] = [];
  let partsKey = "";
  root.classList.add("typstream-pages");

  let geometry: PageGeometry = A4;
  let gaps: Gap[] = [];
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
    for (const el of [flow, marginals])
      Object.assign(el.style, {
        width: `${width}px`,
        padding: `${top}px ${right}px ${bottom}px ${left}px`,
        left: `${first.offsetLeft}px`,
        top: `${first.offsetTop}px`,
        transform: scale === 1 ? "" : `scale(${scale})`,
      });
  };

  /** Each page's header and footer, its number and the count written in. */
  const drawMarginals = () => {
    marginals.replaceChildren();
    if (!parts.length || geometry.height === null) return;
    const pick = (kind: string, first: boolean) =>
      (parts.find(
        (n) =>
          n.nodeType === 1 &&
          (n as Element).classList.contains(kind) &&
          (n as Element).classList.contains("ts-first") === first,
      ) as Element | undefined) ?? null;
    const [top, , bottom, left] = geometry.margin.map((m) => m * PX) as [number, number, number, number];
    const width = pageWidth() - left - geometry.margin[1] * PX;
    for (let i = 0; i < count; i++) {
      for (const [kind, y, h, end] of [
        ["ts-page-header", sheetTop(i), top - geometry.ascent * PX, true],
        ["ts-page-footer", sheetTop(i) + pageHeight() - bottom + geometry.descent * PX, bottom - geometry.descent * PX, false],
      ] as const) {
        const part = pick(kind, i === 0);
        if (!part) continue;
        // Its content in one box, at the end of the header's room or the start of the footer's.
        const el = doc.createElement("div");
        el.className = kind;
        const body = part.cloneNode(true) as HTMLElement;
        body.className = "ts-marginal";
        el.append(body);
        Object.assign(el.style, {
          position: "absolute",
          left: `${left}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${Math.max(0, h)}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: end ? "flex-end" : "flex-start",
        });
        const walker = doc.createTreeWalker(el, 4);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const text = t as Text;
          text.data = text.data.replaceAll(PAGE_NUMBER, String(i + 1));
        }
        marginals.append(el);
      }
    }
  };

  /** Top of sheet `i` in the flow's own px. */
  const sheetTop = (i: number): number => (sheet(i).offsetTop - sheet(0).offsetTop) / scale;
  const pageHeight = () => (geometry.height ?? 0) * PX;
  const contentTop = (i: number) => sheetTop(i) + geometry.margin[0] * PX;
  const contentBottom = (i: number) => sheetTop(i) + pageHeight() - geometry.margin[2] * PX;

  /** A rectangle's top and bottom in the flow's own px. */
  const origin = () => flow.getBoundingClientRect().top;
  const inFlow = (r: { top: number; bottom: number }, o: number) => ({ top: (r.top - o) / scale, bottom: (r.bottom - o) / scale });

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

  /** A unit for an element that doesn't break. */
  const whole = (el: Element, sticky?: Element): Unit => ({
    measure: () => inFlow(el.getBoundingClientRect(), origin()),
    gap: () => spacerBefore(el, true),
    ...(sticky ? { sticky } : {}),
  });

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

  /** The text nodes and inline atoms of an inline run, deep, with their boxes. */
  const boxes = (nodes: Node[], o: number, out: { top: number; bottom: number }[]): void => {
    const range = doc.createRange();
    for (const node of nodes) {
      if (node.nodeType === 3) {
        if (!(node as Text).data.trim()) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.height > 0) out.push(inFlow(r, o));
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
          range.setStart(start.text, start.offset);
          range.setEnd(start.text, start.offset + 1);
          const r = range.getClientRects()[0] ?? (start.text.parentElement as Element).getBoundingClientRect();
          return inFlow(r, now).top;
        }
        range.selectNode((start as Element | null) ?? first);
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
            return spacerBefore(rest, false);
          }
          // A paragraph's first line: room before the paragraph (and what it starts), where its own indent stays.
          if (!start) return spacerBefore(opening(first), true);
          return spacerBefore(start, false);
        },
        ...(sticky ? { sticky } : {}),
      };
      units.push(unit);
    }
    for (const [index, unit] of units.entries()) unit.par = { index, lines: units };
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
  const gridRows = (grid: Element, o: number, out: Unit[]): void => {
    const cells = [...grid.querySelectorAll<HTMLElement>(":scope > .ts-cell, :scope > .ts-row > .ts-cell")];
    const rows = new Map<number, HTMLElement[]>();
    for (const cell of cells) {
      const row = Number.parseInt(view.getComputedStyle(cell).gridRowStart, 10) || 0;
      rows.set(row, [...(rows.get(row) ?? []), cell]);
    }
    const breakable = !grid.classList.contains("ts-table") && !grid.closest(".ts-whole");
    for (const row of [...rows.keys()].sort((a, b) => a - b)) {
      const these = rows.get(row) as HTMLElement[];
      const measure = () => {
        const now = origin();
        const rects = these.map((c) => inFlow(c.getBoundingClientRect(), now));
        return { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) };
      };
      const first: Unit = { measure, gap: () => rowGap(these) };
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
    let force: boolean | "weak" = false;
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
    }
    flush();
  };

  // --- breaking ----------------------------------------------------------------------

  const clear = () => {
    for (const gap of gaps) gap.remove();
    gaps = [];
  };

  /** The unit to move to the next page when `units[i]` doesn't fit: Typst keeps orphans, widows and sticky blocks. */
  const breakAt = (units: Unit[], i: number, top: number): number => {
    let j = i;
    const unit = units[j] as Unit;
    const par = unit.par;
    if (par && par.lines.length >= 2) {
      const n = par.lines.length;
      // Two lines at the start (orphans), two at the end (widows), all three of three.
      const index = par.index === 1 || (n === 3 && par.index === 2) ? 0 : par.index === n - 1 && n >= 3 ? n - 2 : par.index;
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

  const paginate = (from: Node | null) => {
    place();
    const key = JSON.stringify([geometry, pageWidth(), scale]);
    if (key !== laidOut || geometry.height === null) from = null;
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
    if (!start && head && first && !head.force && head.measure().top > contentTop(0) + EPS) {
      const gap = spacerBefore(first, true);
      gaps.push(gap);
      gap.set(contentTop(0) - head.measure().top);
    }
    for (let i = 0; i < units.length; i++) {
      const unit = units[i] as Unit;
      let { top, bottom } = unit.measure();
      // On a page kept as it was (the lines of a block before its break).
      if (start && top < contentTop(page) - EPS) continue;
      // A weak break where the page has nothing above yet is no break.
      if (unit.force === "weak" && top <= contentTop(page) + EPS) continue;
      if (unit.force) {
        page++;
        sheet(page);
        place();
      } else if (bottom <= contentBottom(page) + EPS || top <= contentTop(page) + EPS) continue;
      else {
        const j = breakAt(units, i, contentTop(page));
        page++;
        sheet(page);
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
      gap.set(1 + contentTop(page) - top);
    }
    count = page + 1;
    while (sheets.children.length > count) sheets.lastElementChild?.remove();
    drawMarginals();
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
      const target = href?.startsWith("#") ? flow.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`) : null;
      if (!target) continue;
      const top = inFlow(target.getBoundingClientRect(), origin()).top;
      let page = 0;
      while (page + 1 < tops.length && (tops[page + 1] as number) <= top + EPS) page++;
      span.textContent = String(page + 1);
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
    else if (pending && from && !(pending.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING)) pending = from;
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
      root.classList.remove("typstream-pages");
    },
  };
};
