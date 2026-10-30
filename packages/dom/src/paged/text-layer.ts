// The text layer over a page (#14): the page SVG draws glyphs as paths, so
// selection, copy, find-in-page and screen readers use invisible HTML text laid
// over them instead, as pdf.js does for PDFs. Runs come from engine-wasm
// (`PageUpdate.text`, Typst's text in reading order with its position).
//
// Why HTML spans, not SVG <text> (measured in #14): with SVG text, copying
// gives a newline after every run in Chromium and WebKit (math comes out one
// symbol per line) and nothing between lines in Firefox. Spans with <br> at line
// ends copy the same way in all three, and find-in-page works with both.
//
// Structure (#63): headings, lists and tables (`PageUpdate.structure`) wrap
// their runs in unstyled inline spans with ARIA roles, so screen readers can
// move between headings and through tables. Inline, not <h2> or <table>: the
// runs are positioned against the layer either way, but block elements would
// add line breaks to copied text and pick up the app's styles for h2, ul or
// table. The layer has the document's `lang` and `dir`, runs their own where
// they differ.

import type { PageUpdate, TextNode, TextRun } from "@typstream/core";

type Dir = "ltr" | "rtl";

/** A run as the layer draws it. */
export interface LaidRun extends TextRun {
  /** Where the span starts and the advance it is stretched to: the run's, plus the gap when a space was added. */
  x: number;
  width: number;
  /** A line break follows (copied text gets a newline). */
  br: boolean;
}

/** `next` starts back at the beginning of a line set in direction `dir`, after `run`. */
const startsBack = (run: TextRun, next: TextRun, dir?: Dir): boolean =>
  dir === "rtl"
    ? next.x + next.width > run.x + run.size / 2
    : dir === "ltr" && next.x < run.x + run.width - run.size / 2;

/**
 * Turns runs (in reading order) into what the layer draws: a line break where
 * the next run is on another baseline back at the start of a line (the left in
 * `dir: "ltr"`, the right in `"rtl"`), and a space where Typst left a gap
 * between two runs on a line (a heading's number and its text, table cells),
 * on whichever side the next one is. Sub- and superscripts sit on other
 * baselines but continue the line, so they don't break it. Runs with others
 * between them on screen (text in another direction) get no space: the gap
 * isn't between them.
 */
export const layoutRuns = (runs: readonly TextRun[], dir: Dir = "ltr"): LaidRun[] => {
  const out: LaidRun[] = runs.map((run) => ({ ...run, br: false }));
  const sameLine = (run: TextRun, next: TextRun) => Math.abs(next.y - run.y) < run.size * 0.75;
  for (let i = 0; i + 1 < runs.length; i++) {
    const run = runs[i] as TextRun;
    const next = runs[i + 1] as TextRun;
    (out[i] as LaidRun).br = !sameLine(run, next) && (startsBack(run, next, dir) || startsBack(run, next, run.dir));
  }
  let line = 0;
  for (let i = 0; i + 1 < runs.length; i++) {
    const laid = out[i] as LaidRun;
    const run = runs[i] as TextRun;
    const next = runs[i + 1] as TextRun;
    if (laid.br) line = i + 1;
    if (laid.br || /\s$/.test(run.text) || /^\s/.test(next.text)) continue;
    const slack = run.size * 0.15;
    const right = next.x - run.x - run.width;
    const left = run.x - next.x - next.width;
    if (Math.max(right, left) <= slack) continue;
    const [from, to] = right > left ? [run.x + run.width, next.x] : [next.x + next.width, run.x];
    let between = false;
    for (let k = line; k < runs.length && !between; k++) {
      const other = runs[k] as TextRun;
      between = k !== i && k !== i + 1 && other.x < to - slack && other.x + other.width > from + slack;
      if (k > i && (out[k] as LaidRun).br) break;
    }
    if (between) continue;
    laid.text += " ";
    if (run.matrix || !sameLine(run, next)) continue;
    // The space is at the run's end: on its right in LTR text, on its left in RTL.
    const rtl = (run.dir ?? dir) === "rtl";
    if (right > left && !rtl) laid.width = next.x - run.x;
    else if (left > right && rtl) {
      laid.x = next.x + next.width;
      laid.width = run.x + run.width - laid.x;
    }
  }
  return out;
};

/** The font the layer's spans use, and the one they are measured in. */
const FONT = "sans-serif";
/** Where the baseline sits in a span with `line-height: 1`, as a share of the font size (typical sans ascent). */
const ASCENT = 0.8;

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** Width of `text` at a font size of 1 in the layer's font (canvas, no layout). Cached. */
const measure = (text: string): number => {
  let w = widths.get(text);
  if (w !== undefined) return w;
  if (context === undefined) {
    context = document.createElement("canvas").getContext("2d");
    if (context) context.font = `100px ${FONT}`;
  }
  w = context ? context.measureText(text).width / 100 : 0;
  if (widths.size > 20_000) widths.clear();
  widths.set(text, w);
  return w;
};

/** A box on a page, in points: `[x, y, width, height]`. */
export type Box = readonly [number, number, number, number];

/**
 * Fills `layer` with spans for a page's text runs, inside spans for its
 * structure. Positions are in container query units of the page element
 * (`cqw`), so the layer follows the page's rendered size without script.
 * Styles are set through the CSSOM, which strict CSPs allow (inline `style`
 * attributes are not). Runs whose middle is in one of `covered` (islands
 * mounted over their fallback, #28) are hidden from assistive technology:
 * the island reads instead.
 */
export const fillTextLayer = (layer: HTMLElement, page: PageUpdate, covered: readonly Box[] = []): void => {
  // One unit: a point at the page's rendered width.
  const unit = 100 / page.width;
  const cqw = (pt: number) => `${(pt * unit).toFixed(4)}cqw`;
  const doc = layer.ownerDocument;
  const attr = (el: Element, name: string, value: string | number | undefined) =>
    value === undefined ? el.removeAttribute(name) : el.setAttribute(name, String(value));
  attr(layer, "lang", page.lang);
  attr(layer, "dir", page.dir);
  const runs = layoutRuns(page.text ?? [], page.dir);
  let placed = 0;
  /** Appends the runs up to `to` to `parent`. */
  const place = (parent: Node, to: number) => {
    for (; placed < Math.min(to, runs.length); placed++) {
      const run = runs[placed] as LaidRun;
      const span = doc.createElement("span");
      span.textContent = run.text;
      const [mx, my] = [run.x + run.width / 2, run.y - run.size / 3];
      if (covered.some(([x, y, w, h]) => mx >= x && mx <= x + w && my >= y && my <= y + h))
        span.setAttribute("aria-hidden", "true");
      attr(span, "lang", run.lang);
      attr(span, "dir", run.dir);
      const style = span.style;
      style.left = cqw(run.x);
      style.top = cqw(run.y - run.size * ASCENT);
      style.fontSize = cqw(run.size);
      const natural = measure(run.text) * run.size;
      const stretch = natural > 0 ? run.width / natural : 1;
      const linear = run.matrix ? `matrix(${run.matrix.join(",")},0,0) ` : "";
      style.transform = `${linear}scaleX(${stretch.toFixed(4)})`;
      parent.appendChild(span);
      if (run.br) parent.appendChild(doc.createElement("br"));
    }
  };
  const build = (parent: Node, nodes: readonly TextNode[] = []) => {
    for (const node of nodes) {
      place(parent, node.from);
      const el = doc.createElement("span");
      attr(el, "role", node.role);
      attr(el, "aria-level", node.level);
      build(el, node.children);
      place(el, node.to);
      parent.appendChild(el);
    }
  };
  const fragment = doc.createDocumentFragment();
  build(fragment, page.structure);
  place(fragment, runs.length);
  layer.replaceChildren(fragment);
};

/** CSS for the layer; `.typstream-page` is its container (`container-type: inline-size`). */
export const TEXT_LAYER_CSS = `
.typstream-text-layer { position: absolute; inset: 0; contain: strict; overflow: hidden; line-height: 1; color: transparent; font-family: ${FONT}; forced-color-adjust: none; }
.typstream-text-layer span:not([role]) { position: absolute; white-space: pre; transform-origin: 0 ${ASCENT}em; cursor: text; }
.typstream-text-layer ::selection { background: rgb(0 100 255 / 0.25); color: transparent; }
`;
