// Where the document's text is on the pages, as the engine laid it out (`PagedArtifact.positions`,
// #36): glyph clusters with the range of the source each shows, grouped into lines, and the
// elements on each page with their boxes. The editor's caret, selection, clicks and arrow keys are
// all answered here, against Typst's own layout, so the page being edited is the page exported.

import type { PagedArtifact, PageElement, PagePositions } from "@typstream/core";

/** Floats per glyph in `PagePositions.glyphs`. */
const STRIDE = 8;
/** Glyph flag: its range is exactly the characters it shows. */
export const EXACT = 1;
/** Glyph flag: math. */
export const MATH = 2;
/** Glyph flag: shaped right to left. */
export const RTL = 4;

/** A glyph cluster on a page. Points from the page's top left. */
export interface Glyph {
  page: number;
  /** Left edge. */
  x: number;
  /** Baseline. */
  y: number;
  width: number;
  ascent: number;
  descent: number;
  /** The source it shows, `[from, to)`, or -1 when it doesn't show the document's text. */
  from: number;
  to: number;
  flags: number;
  /** Index of its line in {@link Layout.lines}. */
  line: number;
}

/** A line of text: glyphs next to each other on one baseline, in the order Typst laid them out. */
export interface Line {
  page: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Glyph indices `[first, last]`. */
  first: number;
  last: number;
}

/** An element on a page (see core's `PageElement`), with its page. */
export interface LaidElement extends PageElement {
  page: number;
}

/** Where a caret goes: a vertical bar on a page. */
export interface CaretBox {
  page: number;
  x: number;
  top: number;
  bottom: number;
}

/** A rectangle on a page, in points. */
export interface PageRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const decode = (positions: PagePositions, page: number, out: Glyph[]) => {
  const bytes = positions.glyphs;
  const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (let i = 0; i + STRIDE <= f.length; i += STRIDE) {
    out.push({
      page,
      x: f[i] as number,
      y: f[i + 1] as number,
      width: f[i + 2] as number,
      ascent: f[i + 3] as number,
      descent: f[i + 4] as number,
      from: f[i + 5] as number,
      to: f[i + 6] as number,
      flags: f[i + 7] as number,
      line: -1,
    });
  }
};

/** Whether `g` continues the line `line` ends with `prev`: the same page, overlapping heights, going on rightwards. */
const continues = (line: Line, prev: Glyph, g: Glyph): boolean => {
  if (g.page !== line.page) return false;
  const top = g.y - g.ascent;
  const bottom = g.y + g.descent;
  const overlap = Math.min(bottom, line.bottom) - Math.max(top, line.top);
  if (overlap < Math.min(bottom - top, line.bottom - line.top) * 0.5) return false;
  // Back at a line's start, or a jump to another column or cell.
  return g.x >= prev.x - 0.5 && g.x - (prev.x + prev.width) < Math.max(prev.ascent, g.ascent) * 3;
};

/**
 * A document's layout: its glyphs, lines and elements, from a paged artifact with positions.
 * Offsets are in the text the artifact was compiled from (`DocumentState.artifactInput`).
 */
export class Layout {
  readonly glyphs: Glyph[] = [];
  readonly lines: Line[] = [];
  readonly elements: LaidElement[] = [];
  /** Page sizes, in points. */
  readonly pages: { width: number; height: number }[];
  /** Indices of glyphs that show the document's text, sorted by `from`. */
  private readonly bySource: number[];

  constructor(artifact: PagedArtifact) {
    this.pages = artifact.pages.map((p) => ({ width: p.width, height: p.height }));
    (artifact.positions ?? []).forEach((positions, page) => {
      decode(positions, page, this.glyphs);
      for (const e of positions.elements) this.elements.push({ ...e, page });
    });
    let line: Line | null = null;
    this.glyphs.forEach((g, i) => {
      const prev = this.glyphs[i - 1];
      if (!line || !prev || !continues(line, prev, g)) {
        line = { page: g.page, top: g.y - g.ascent, bottom: g.y + g.descent, left: g.x, right: g.x + g.width, first: i, last: i };
        this.lines.push(line);
      } else {
        line.top = Math.min(line.top, g.y - g.ascent);
        line.bottom = Math.max(line.bottom, g.y + g.descent);
        line.left = Math.min(line.left, g.x);
        line.right = Math.max(line.right, g.x + g.width);
        line.last = i;
      }
      g.line = this.lines.length - 1;
    });
    this.bySource = this.glyphs
      .map((g, i) => [g, i] as const)
      .filter(([g]) => g.from >= 0)
      .sort((a, b) => a[0].from - b[0].from || a[0].to - b[0].to || a[1] - b[1])
      .map(([, i]) => i);
  }

  /** Glyphs that show text and are on the pages: the document has visible text. */
  get empty(): boolean {
    return this.bySource.length === 0;
  }

  /** Index into `bySource` of the first glyph whose `from` is at least `offset`. */
  private lowerBound(offset: number): number {
    let lo = 0;
    let hi = this.bySource.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.glyphs[this.bySource[mid] as number] as Glyph).from < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Editable glyphs (exact text, not math) whose range touches `offset`, in source order. */
  glyphsAround(offset: number): { before: Glyph | null; after: Glyph | null; inside: Glyph | null } {
    const at = this.lowerBound(offset);
    let after: Glyph | null = null;
    let inside: Glyph | null = null;
    let before: Glyph | null = null;
    for (let k = at; k < this.bySource.length; k++) {
      const g = this.glyphs[this.bySource[k] as number] as Glyph;
      if (g.from !== offset) break;
      if (!after || better(g, after)) after = g;
    }
    // Looking back: a glyph ending at the offset, or one containing it (a ligature, a whole node).
    for (let k = at - 1; k >= 0 && k >= at - 64; k--) {
      const g = this.glyphs[this.bySource[k] as number] as Glyph;
      if (g.to === offset && (!before || better(g, before))) before = g;
      else if (g.from < offset && offset < g.to && !inside) inside = g;
    }
    return { before, after, inside };
  }

  /**
   * Where a caret at `offset` goes. `affinity` -1 prefers the end of the glyph before (the end of a
   * line when the offset is also the next line's start), 1 the start of the glyph after. `null`
   * when no glyph is near: the caller places it from the elements or the block around it.
   */
  caret(offset: number, affinity: 1 | -1 = 1): CaretBox | null {
    const { before, after, inside } = this.glyphsAround(offset);
    const end = (g: Glyph): CaretBox => box(g, g.flags & RTL ? g.x : g.x + g.width);
    const start = (g: Glyph): CaretBox => box(g, g.flags & RTL ? g.x + g.width : g.x);
    if (inside) {
      // Inside a cluster (a ligature): in proportion.
      const share = (offset - inside.from) / (inside.to - inside.from);
      const x = inside.flags & RTL ? inside.x + inside.width * (1 - share) : inside.x + inside.width * share;
      return box(inside, x);
    }
    if (before && after) {
      // A line break between them: the affinity decides.
      if (before.line !== after.line) return affinity < 0 ? end(before) : start(after);
      return start(after);
    }
    if (after) return start(after);
    if (before) return end(before);
    return null;
  }

  /** The nearest glyph showing text before `offset` (by source), and after it. */
  neighbors(offset: number): { prev: Glyph | null; next: Glyph | null } {
    const at = this.lowerBound(offset);
    let prev: Glyph | null = null;
    for (let k = at - 1; k >= 0; k--) {
      const g = this.glyphs[this.bySource[k] as number] as Glyph;
      if (g.to <= offset) {
        if (!prev || g.to > prev.to) prev = g;
        if (k < at - 64) break;
      }
    }
    const next = at < this.bySource.length ? (this.glyphs[this.bySource[at] as number] as Glyph) : null;
    return { prev, next };
  }

  /**
   * The source offset at a point on page `page` (points), for a click: on the nearest line, the
   * nearest glyph edge. `glyph` is the glyph hit, whether or not it shows the document's text.
   */
  hit(page: number, x: number, y: number): { offset: number | null; glyph: Glyph | null; line: Line | null } {
    const line = this.lineAt(page, x, y);
    if (!line) return { offset: null, glyph: null, line: null };
    let best: Glyph | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = line.first; i <= line.last; i++) {
      const g = this.glyphs[i] as Glyph;
      const d = x < g.x ? g.x - x : x > g.x + g.width ? x - g.x - g.width : 0;
      if (d < bestDist) {
        best = g;
        bestDist = d;
      }
    }
    if (!best) return { offset: null, glyph: null, line };
    const editable = best.from >= 0 ? best : this.nearestOnLine(line, x);
    if (!editable) return { offset: null, glyph: best, line };
    const right = x > editable.x + editable.width / 2;
    const rtl = (editable.flags & RTL) !== 0;
    if (editable.flags & EXACT && editable.to - editable.from > 1 && x > editable.x && x < editable.x + editable.width) {
      // A ligature: the nearest character boundary inside it.
      const share = (x - editable.x) / editable.width;
      const n = Math.round((rtl ? 1 - share : share) * (editable.to - editable.from));
      return { offset: editable.from + n, glyph: best, line };
    }
    return { offset: right !== rtl ? editable.to : editable.from, glyph: best, line };
  }

  private nearestOnLine(line: Line, x: number): Glyph | null {
    let best: Glyph | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = line.first; i <= line.last; i++) {
      const g = this.glyphs[i] as Glyph;
      if (g.from < 0) continue;
      const d = Math.abs(g.x + g.width / 2 - x);
      if (d < bestDist) {
        best = g;
        bestDist = d;
      }
    }
    return best;
  }

  /** The line under `(x, y)` on `page`, or the nearest one. */
  lineAt(page: number, x: number, y: number): Line | null {
    let best: Line | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const line of this.lines) {
      if (line.page !== page) continue;
      const dy = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
      const dx = x < line.left ? line.left - x : x > line.right ? x - line.right : 0;
      // Vertical distance first: a click beside a line is on it.
      const score = dy * 4 + dx * 0.25;
      if (score < bestScore) {
        best = line;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * The line above (`dir` -1) or below (1) `line` for arrow keys: on the same page or the next,
   * the nearest whose horizontal extent is near `x`.
   */
  lineBeside(line: Line, dir: 1 | -1, x: number): Line | null {
    const index = this.lines.indexOf(line);
    let best: Line | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = index + dir; i >= 0 && i < this.lines.length; i += dir) {
      const other = this.lines[i] as Line;
      const pageGap = (other.page - line.page) * dir;
      if (pageGap > 1) break;
      const below = pageGap > 0 || (dir > 0 ? other.top >= line.bottom - 1 : other.bottom <= line.top + 1);
      if (!below) continue;
      const dy = pageGap > 0 ? 1000 * pageGap + (dir > 0 ? other.top : this.height(other.page) - other.bottom) : dir > 0 ? other.top - line.bottom : line.top - other.bottom;
      const dx = x < other.left ? other.left - x : x > other.right ? x - other.right : 0;
      const score = dy + dx * 2;
      if (score < bestScore) {
        best = other;
        bestScore = score;
      }
      if (dy > 200 && best) break;
    }
    return best;
  }

  private height(page: number): number {
    return this.pages[page]?.height ?? 0;
  }

  /** The offset on `line` nearest to `x`. */
  offsetOnLine(line: Line, x: number): number | null {
    return this.hit(line.page, x, (line.top + line.bottom) / 2).offset;
  }

  /** The first and last offsets shown on `line`. */
  lineRange(line: Line): { from: number; to: number } | null {
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (let i = line.first; i <= line.last; i++) {
      const g = this.glyphs[i] as Glyph;
      if (g.from < 0) continue;
      from = Math.min(from, g.from);
      to = Math.max(to, g.to);
    }
    return from <= to ? { from, to } : null;
  }

  /** The line a caret at `offset` is on. */
  lineOf(offset: number, affinity: 1 | -1 = 1): Line | null {
    const { before, after, inside } = this.glyphsAround(offset);
    const g = inside ?? (affinity < 0 ? (before ?? after) : (after ?? before));
    return g ? (this.lines[g.line] ?? null) : null;
  }

  /** Rectangles covering the text of `[from, to)`, one per line piece, for a selection. */
  rects(from: number, to: number): PageRect[] {
    const out: PageRect[] = [];
    const byLine = new Map<number, { x0: number; x1: number; line: Line }>();
    for (const g of this.glyphs) {
      if (g.from < 0 || g.to <= from || g.from >= to) continue;
      let x0 = g.x;
      let x1 = g.x + g.width;
      if (g.flags & EXACT && g.to - g.from > 1) {
        // Part of a ligature.
        const a = Math.max(0, (from - g.from) / (g.to - g.from));
        const b = Math.min(1, (to - g.from) / (g.to - g.from));
        x0 = g.x + g.width * a;
        x1 = g.x + g.width * b;
      }
      const line = this.lines[g.line] as Line;
      const r = byLine.get(g.line);
      if (r) {
        r.x0 = Math.min(r.x0, x0);
        r.x1 = Math.max(r.x1, x1);
      } else byLine.set(g.line, { x0, x1, line });
    }
    for (const { x0, x1, line } of byLine.values())
      out.push({ page: line.page, x: x0, y: line.top, width: Math.max(x1 - x0, 1), height: line.bottom - line.top });
    return out;
  }

  /**
   * The boxes of `[from, to)` (a component's call) on the pages: per page, the outermost elements
   * covering only text of that range, and the glyphs of it outside them.
   */
  boxes(from: number, to: number): PageRect[] {
    const byPage = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
    const add = (page: number, x0: number, y0: number, x1: number, y1: number) => {
      const b = byPage.get(page);
      if (b) {
        b.x0 = Math.min(b.x0, x0);
        b.y0 = Math.min(b.y0, y0);
        b.x1 = Math.max(b.x1, x1);
        b.y1 = Math.max(b.y1, y1);
      } else byPage.set(page, { x0, y0, x1, y1 });
    };
    // Outermost elements inside the range: skip the ones inside an element already taken.
    let taken: LaidElement | null = null;
    for (const e of this.elements) {
      if (taken && e.page === taken.page && e.depth > taken.depth && within(e, taken)) continue;
      taken = null;
      if (e.from >= from && e.to <= to && e.box) {
        const [x, y, w, h] = e.box;
        add(e.page, x, y, x + w, y + h);
        taken = e;
      }
    }
    for (const g of this.glyphs) {
      if (g.from < from || g.to > to || g.from < 0) continue;
      add(g.page, g.x, g.y - g.ascent, g.x + g.width, g.y + g.descent);
    }
    return [...byPage].map(([page, b]) => ({ page, x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }));
  }

  /** Elements of `kind` whose own source is `[from, to)` or inside it. */
  elementsIn(from: number, to: number, kind?: string): LaidElement[] {
    return this.elements.filter((e) => (!kind || e.kind === kind) && e.node && e.node[0] >= from && e.node[1] <= to);
  }
}

/** Whether `inner`'s box is inside `outer`'s (a nested element in the walk). */
const within = (inner: LaidElement, outer: LaidElement): boolean => {
  if (!inner.box || !outer.box) return true;
  const [x, y, w, h] = inner.box;
  const [ox, oy, ow, oh] = outer.box;
  return x >= ox - 0.5 && y >= oy - 0.5 && x + w <= ox + ow + 0.5 && y + h <= oy + oh + 0.5;
};

/** Of two glyphs at one offset, the one to put a caret at: text over a node's glyph, then not math. */
const better = (g: Glyph, than: Glyph): boolean => (g.flags & EXACT) > (than.flags & EXACT) || ((g.flags & EXACT) === (than.flags & EXACT) && (g.flags & MATH) < (than.flags & MATH));

const box = (g: Glyph, x: number): CaretBox => ({ page: g.page, x, top: g.y - g.ascent, bottom: g.y + g.descent });
