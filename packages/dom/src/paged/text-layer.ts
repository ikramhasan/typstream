// The text layer over a page (#14): the page SVG draws glyphs as paths, so
// selection, copy, find-in-page and screen readers use invisible HTML text laid
// over them instead, as pdf.js does for PDFs. Runs come from engine-wasm
// (`PageUpdate.text`, Typst's text items with their position).
//
// Why HTML spans, not SVG <text> (measured in #14): with SVG text, copying
// gives a newline after every run in Chromium and WebKit (math comes out one
// symbol per line) and nothing between lines in Firefox. Spans with <br> at line
// ends copy the same way in all three, and find-in-page works with both.

import type { TextRun } from "@typstream/core";

/** A run as the layer draws it. */
export interface LaidRun {
  text: string;
  x: number;
  y: number;
  size: number;
  /** Advance the span is stretched to: the run's, plus the gap when a space was added. */
  width: number;
  matrix?: [number, number, number, number];
  /** A line break follows (copied text gets a newline). */
  br: boolean;
}

/**
 * Turns runs into what the layer draws: a space where Typst left a gap between
 * runs on a line (a heading's number and its text, table cells), a line break
 * where the next run starts back to the left on another baseline. Sub- and
 * superscripts sit on other baselines but continue to the right, so they don't
 * break the line.
 */
export const layoutRuns = (runs: readonly TextRun[]): LaidRun[] => {
  const out: LaidRun[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] as TextRun;
    const next = runs[i + 1];
    const laid: LaidRun = { text: run.text, x: run.x, y: run.y, size: run.size, width: run.width, br: false };
    if (run.matrix) laid.matrix = run.matrix;
    if (next) {
      const end = run.x + run.width;
      const sameLine = Math.abs(next.y - run.y) < run.size * 0.75;
      if (next.x < end - run.size * 0.5 && !sameLine) laid.br = true;
      else if (next.x - end > run.size * 0.15 && !/\s$/.test(run.text) && !/^\s/.test(next.text)) {
        laid.text += " ";
        if (!run.matrix && sameLine) laid.width = next.x - run.x;
      }
    }
    out.push(laid);
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

/**
 * Fills `layer` with spans for `runs` on a page `width` points wide. Positions
 * are in container query units of the page element (`cqw`), so the layer follows
 * the page's rendered size without script. Styles are set through the CSSOM,
 * which strict CSPs allow (inline `style` attributes are not).
 */
export const fillTextLayer = (layer: HTMLElement, runs: readonly TextRun[], width: number): void => {
  // One unit: a point at the page's rendered width.
  const unit = 100 / width;
  const cqw = (pt: number) => `${(pt * unit).toFixed(4)}cqw`;
  const fragment = document.createDocumentFragment();
  for (const run of layoutRuns(runs)) {
    const span = document.createElement("span");
    span.textContent = run.text;
    const style = span.style;
    style.left = cqw(run.x);
    style.top = cqw(run.y - run.size * ASCENT);
    style.fontSize = cqw(run.size);
    const natural = measure(run.text) * run.size;
    const stretch = natural > 0 ? run.width / natural : 1;
    const linear = run.matrix ? `matrix(${run.matrix.join(",")},0,0) ` : "";
    style.transform = `${linear}scaleX(${stretch.toFixed(4)})`;
    fragment.append(span);
    if (run.br) fragment.append(document.createElement("br"));
  }
  layer.replaceChildren(fragment);
};

/** CSS for the layer; `.typstream-page` is its container (`container-type: inline-size`). */
export const TEXT_LAYER_CSS = `
.typstream-text-layer { position: absolute; inset: 0; overflow: hidden; line-height: 1; color: transparent; font-family: ${FONT}; forced-color-adjust: none; }
.typstream-text-layer > span { position: absolute; white-space: pre; transform-origin: 0 ${ASCENT}em; cursor: text; }
.typstream-text-layer ::selection { background: rgb(0 100 255 / 0.25); color: transparent; }
`;
