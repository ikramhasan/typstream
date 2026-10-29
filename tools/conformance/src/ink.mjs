// What a page draws besides text and pictures (rules, borders, shading, a blank's line) against Typst's PDF (#135): the
// lines compare text only, so a border a DOCX lost, or an underline drawn 2 pt off, would pass them.
//
// Both PDFs are rasterized by poppler at 2 pixels per point. Words (`pdftotext`'s boxes, from both PDFs) and pictures
// (compared by pixels.mjs) are masked out, and with `math` equations' pieces (each engine sets math its own way, #132). A pixel differs when
// it is ink in one and the other has no ink within a point of it; as pdf-raster's suite counts (#119), what matters is
// the most differing pixels that touch: a missing rule is a streak, antialiasing scattered pixels.
import { grey, mathBoxes, pageCount, wordBoxes } from "./lines.mjs";

const SCALE = 2;
/** Darker than this is ink: a 0.4 pt grey rule at 2 pixels per point is. */
const INK = 160;
/** How far, in pixels, the other PDF's ink may be. */
const REACH = 2;
/** Differing pixels that may touch: a rule or border off by more than a point, or missing, is many more. */
export const INK_TOLERANCE = 6;

/**
 * Each page both PDFs have, compared: `{ page, pixels, cluster, box }` (page from 0; `box` the largest cluster's, in
 * points). `regions` are pictures (`{ page, x, y, width, height }`, page from 0) left out; `math` leaves equations out.
 */
export const compareInk = (typst, other, { regions = [], math = false } = {}) => {
  const words = [wordBoxes(typst), wordBoxes(other)];
  const masks = [...regions, ...(math ? [...mathBoxes(typst), ...mathBoxes(other)] : [])];
  const out = [];
  for (let n = 1; n <= Math.min(pageCount(typst), pageCount(other)); n++) {
    const a = grey(typst, n, SCALE);
    const b = grey(other, n, SCALE);
    const w = Math.min(a.w, b.w);
    const h = Math.min(a.h, b.h);
    const mask = new Uint8Array(w * h);
    const cover = (x0, y0, x1, y1) => {
      for (let y = Math.max(0, Math.floor(y0 * SCALE)); y < Math.min(h, Math.ceil(y1 * SCALE)); y++)
        mask.fill(1, y * w + Math.max(0, Math.floor(x0 * SCALE)), y * w + Math.min(w, Math.ceil(x1 * SCALE)));
    };
    for (const [x0, y0, x1, y1] of [...(words[0][n - 1] ?? []), ...(words[1][n - 1] ?? [])])
      cover(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5);
    // Equations' pieces with room for their bars and radicals.
    for (const r of masks.filter((r) => r.page === n - 1))
      cover(r.x - 1, r.y - (r.math ? 3 : 1), r.x + r.width + 1, r.y + r.height + (r.math ? 3 : 1));
    const inked = (img, x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h && img.data[y * img.w + x] < INK;
    const near = (img, x, y) => {
      for (let dy = -REACH; dy <= REACH; dy++)
        for (let dx = -REACH; dx <= REACH; dx++) if (inked(img, x + dx, y + dy)) return true;
      return false;
    };
    const differ = new Uint8Array(w * h);
    const found = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask[i]) continue;
        const ia = inked(a, x, y);
        if (ia === inked(b, x, y) || near(ia ? b : a, x, y)) continue;
        differ[i] = 1;
        found.push(i);
      }
    out.push({ page: n - 1, pixels: found.length, ...largest(differ, found, w, h) });
  }
  return out;
};

/** The largest 8-connected cluster of `differ`'s pixels (1s; `found` lists them), and its box in points. */
const largest = (differ, found, w, h) => {
  let cluster = 0;
  let box = null;
  for (const start of found) {
    if (differ[start] !== 1) continue;
    differ[start] = 2;
    const stack = [start];
    let size = 0;
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    while (stack.length) {
      const at = stack.pop();
      const x = at % w;
      const y = (at - x) / w;
      size++;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const u = x + dx;
          const v = y + dy;
          if (u < 0 || v < 0 || u >= w || v >= h || differ[v * w + u] !== 1) continue;
          differ[v * w + u] = 2;
          stack.push(v * w + u);
        }
    }
    if (size > cluster) {
      cluster = size;
      box = [x0, y0, x1 + 1, y1 + 1].map((v) => Math.round(v / SCALE));
    }
  }
  return { cluster, box };
};
