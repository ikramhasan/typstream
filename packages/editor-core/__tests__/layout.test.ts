// The layout's answers on positions written by hand: what a running header or a table's repeated
// header (the same text on several pages) does to the caret and the arrow keys.

import type { PagedArtifact } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { Layout } from "../src/layout";

/** A glyph: `[x, baseline, width, size, from, to, flags]` (flags 1: exact text). */
type G = [number, number, number, number, number, number, number?];

/** A run of exact glyphs for `[from, from + n)`, 6 pt apart at `size`. */
const run = (x: number, y: number, size: number, from: number, n: number): G[] =>
  Array.from({ length: n }, (_, i) => [x + i * size * 0.5, y, size * 0.5, size, from + i, from + i + 1, 1] as G);

/** Template words: `n` glyphs showing none of the document. */
const words = (x: number, y: number, n: number): G[] =>
  Array.from({ length: n }, (_, i) => [x + i * 5, y, 5, 10, -1, -1, 0] as G);

const layoutOf = (...pages: G[][]): Layout => {
  const positions = pages.map((glyphs) => {
    const f = new Float32Array(glyphs.length * 8);
    glyphs.forEach(([x, y, width, size, from, to, flags = 1], i) => {
      f.set([x, y, width, size * 0.8, size * 0.2, from, to, flags], i * 8);
    });
    return { glyphs: new Uint8Array(f.buffer), elements: [] };
  });
  return new Layout({
    pages: pages.map(() => ({ width: 600, height: 800 })),
    positions,
  } as unknown as PagedArtifact);
};

describe("text shown on several pages", () => {
  // A title (0..5) at 20 pt, a body line (10..20), then on page 2 the title again in a small
  // header, with "Candidate:" far right of it, and a body line (30..40).
  const layout = layoutOf(
    [...run(200, 80, 20, 0, 5), ...run(50, 700, 12, 10, 10), ...words(290, 780, 5)],
    [...run(50, 30, 8, 0, 5), ...words(400, 30, 10), ...run(50, 80, 12, 30, 10)],
  );
  const [title, body, footer, header, candidate, next] = layout.lines;

  it("keeps the lines as laid out", () => {
    expect(layout.lines).toHaveLength(6);
    expect([title?.page, header?.page, next?.page]).toEqual([0, 1, 1]);
    expect(candidate?.left).toBe(400);
  });

  it("draws the caret in the title, not in the header", () => {
    for (const offset of [0, 3, 5]) expect(layout.caret(offset)?.page).toBe(0);
    expect(layout.caret(5, -1)).toMatchObject({ page: 0, x: 250 });
    expect(layout.lineOf(2)).toBe(title);
  });

  it("has no place for the caret in the header", () => {
    expect(layout.lineRange(header as never)).toBeNull();
    expect(layout.offsetOnLine(header as never, 60)).toBeNull();
    expect(layout.hit(1, 60, 28)).toMatchObject({ offset: null, line: header });
    expect(layout.rects(0, 5).map((r) => r.page)).toEqual([0]);
  });

  it("goes from a page's last line to the next page's first, past footer and header", () => {
    const down = [body, footer, header].map((l) => layout.lineBeside(l as never, 1, 60));
    expect(down).toEqual([footer, header, next]);
    const up = [next, header, footer].map((l) => layout.lineBeside(l as never, -1, 60));
    expect(up).toEqual([header, footer, body]);
  });

  it("takes the larger copy for the text, wherever it is", () => {
    // A table of contents' entry on page 1, its heading on page 2.
    const toc = layoutOf([...run(50, 80, 10, 0, 5)], [...run(50, 80, 16, 0, 5)]);
    expect(toc.caret(0)?.page).toBe(1);
    expect(toc.lineRange(toc.lines[0] as never)).toBeNull();
  });

  it("takes the first of copies alike (a table's header on each page)", () => {
    const table = layoutOf([...run(50, 80, 10, 0, 5)], [...run(50, 40, 10, 0, 5)], [...run(50, 40, 10, 0, 5)]);
    expect(table.caret(5, -1)?.page).toBe(0);
    expect(table.rects(0, 5)).toHaveLength(1);
  });

  it("leaves a node's glyphs on both sides of a page break", () => {
    // A string a call shows (not exact): three glyphs of it end page 1, two start page 2.
    const node = (x: number, y: number, n: number): G[] =>
      Array.from({ length: n }, (_, i) => [x + i * 5, y, 5, 10, 0, 9, 0] as G);
    const split = layoutOf([...node(50, 700, 3)], [...node(50, 80, 2)]);
    expect(split.lineRange(split.lines[1] as never)).toEqual({ from: 0, to: 9 });
  });
});
