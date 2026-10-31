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
  /** Fits it to the room left on its page (px), before it is measured there: columns fill it as Typst's do. */
  fit?(room: number): void;
  /** Fractional spacing (html-compat's `.ts-vfill`): its share of the room its page's content leaves. */
  fr?: HTMLElement;
  /** The first unit of a block aligned in its page (html-compat's `.ts-align-v`): to its middle or its end. */
  align?: { el: Element; at: number };
  /** The footnotes referenced in it (their entries in Typst's endnotes), which go at the foot of its page. */
  notes?: HTMLElement[];
}

const SPACER = "typstream-break";
/** A footnote's reference (typst-html's), and the endnotes it links into. */
const NOTEREF = 'sup[role="doc-noteref"]';
const ENDNOTES = 'section[role="doc-endnotes"]';
/** What html-compat writes for the page number in headers and footers. */
const PAGE_NUMBER = "7777";

/** Elements that don't break across pages. A closed `<details>` too: what it hides has no place to measure. */
const WHOLE =
  ".ts-whole, figure, img, svg, math, typstream-island, .ts-frame, .ts-shape, .ts-line, .ts-columns, pre, .typstream-island, details:not([open])";
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
        [
          "ts-page-footer",
          sheetTop(i) + pageHeight() - bottom + geometry.descent * PX,
          bottom - geometry.descent * PX,
          false,
        ],
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
    const range = doc.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
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
            const r = range.getClientRects()[0] ?? (start.text.parentElement as Element).getBoundingClientRect();
            return inFlow(r, now).top;
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

  // --- breaking ----------------------------------------------------------------------

  const clear = () => {
    for (const gap of [...gaps, ...shifts]) gap.remove();
    gaps = [];
    shifts = [];
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
      return (row.getBoundingClientRect().right - right) / scale;
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
        left: `${left}px`,
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

  const paginate = (from: Node | null) => {
    place();
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
    if (key !== laidOut || geometry.height === null || shifts.length || entries.size) from = null;
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
      // A weak break where the page has nothing above yet is no break.
      if (unit.force === "weak" && top <= contentTop(page) + EPS) continue;
      if (unit.fit && !unit.force) {
        unit.fit(contentEnd(page) - top);
        ({ top, bottom } = unit.measure());
      }
      if (unit.force) {
        fill(i);
        page++;
        sheet(page);
        place();
      } else if (bottom <= contentBottom(page) - noteRoom(page, unit.notes) + EPS || top <= contentTop(page) + EPS) {
        if (unit.notes) pageNotes[page] = [...(pageNotes[page] ?? []), ...unit.notes];
        continue;
      } else {
        const j = breakAt(units, i, contentTop(page));
        // Footnotes of what moves go with it.
        const moving = new Set(units.slice(j, i).flatMap((u) => u.notes ?? []));
        if (moving.size) pageNotes[page] = (pageNotes[page] ?? []).filter((li) => !moving.has(li));
        fill(j);
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
      moved.fit?.(contentEnd(page) - contentTop(page));
      if (moved.notes) pageNotes[page] = [...(pageNotes[page] ?? []), ...moved.notes];
    }
    fill(units.length);
    // A layout from where the document changed that left its end past the last page's (a break before it missed):
    // all of it again.
    const end = units[units.length - 1]?.measure();
    if (start && end && end.bottom > contentEnd(page) + EPS && end.top > contentTop(page) + EPS) return paginate(null);
    count = page + 1;
    while (sheets.children.length > count) sheets.lastElementChild?.remove();
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
      root.classList.remove("typstream-pages");
    },
  };
};
