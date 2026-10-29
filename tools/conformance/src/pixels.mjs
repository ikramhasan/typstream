// Pictures (#133) against Typst's PDF: each picture's region of its page, rasterized from both PDFs by poppler, and
// compared as tools/browser-suites' pdf-raster suite compares the canvas with the PDF (#119): pixels that differ by
// more than antialiasing, and of those, the most that touch. A missing mark is a blob; rasterizers disagree on
// scattered pixels at edges.
//
// Where the text above it came out taller or shorter, the picture is lower or higher, or on the next page, which the
// lines already count: the region is compared where it fits best, and how far that is from Typst's is reported apart.
// That is found on its page and the next at a pixel per point, then to an eighth of a point (pages rasterized at 8
// pixels per point, then averaged down to the 2 compared), as a picture half a pixel off has every sharp edge differ.
import { execFileSync } from "node:child_process";

/** Pixels per point compared at, and found at. */
const SCALE = 2;
const FINE = 8;
const STEP = FINE / SCALE;
/** Colour distance at which two pixels differ: the largest channel difference (pdf-raster's). */
const THRESHOLD = 96;
/** How far the region is looked for around where Typst drew it, or where it was found, in points. */
const REACH = { here: 6, found: 2, x: 8 };
/** Differing pixels a picture may have touching: pdf-raster's tolerance (#119). */
export const TOLERANCE = 3;

/** A part of page `n` (from 1) of a PDF as RGB pixels at `scale` per point: `x, y, w, h` in points. */
const raster = (pdf, n, x, y, w, h, scale = FINE) => {
  const x0 = Math.max(0, Math.round(x * scale));
  const y0 = Math.max(0, Math.round(y * scale));
  const px = (v) => String(Math.max(1, Math.round(v * scale)));
  const ppm = execFileSync(
    "pdftoppm",
    [
      "-r",
      String(72 * scale),
      "-f",
      String(n),
      "-l",
      String(n),
      "-x",
      String(x0),
      "-y",
      String(y0),
      "-W",
      px(w),
      "-H",
      px(h),
      pdf,
    ],
    // A page past the last is a throw, not a message.
    { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] },
  );
  // P6, width height, 255, then the pixels.
  let at = 0;
  const fields = [];
  while (fields.length < 4) {
    while (ppm[at] === 0x20 || ppm[at] === 0x0a) at++;
    const start = at;
    while (ppm[at] !== 0x20 && ppm[at] !== 0x0a) at++;
    fields.push(ppm.toString("latin1", start, at));
  }
  // Where it starts on the page, in fine pixels.
  return { x: x0, y: y0, w: Number(fields[1]), h: Number(fields[2]), data: ppm.subarray(at + 1) };
};

/** A channel of the fine pixel at page position (x, y); white outside the raster. */
const channel = (img, x, y, c) => {
  const u = x - img.x;
  const v = y - img.y;
  if (u < 0 || v < 0 || u >= img.w || v >= img.h) return 255;
  return img.data[(v * img.w + u) * 3 + c];
};

/** How dark a fine pixel at page position (x, y) is: 0 for white. */
const ink = (img, x, y) => 765 - channel(img, x, y, 0) - channel(img, x, y, 1) - channel(img, x, y, 2);

const near = (a, i, b, j) =>
  Math.abs(a[i] - b[j]) <= THRESHOLD &&
  Math.abs(a[i + 1] - b[j + 1]) <= THRESHOLD &&
  Math.abs(a[i + 2] - b[j + 2]) <= THRESHOLD;

/**
 * Typst's PDF and another's, compared on pictures' regions `{ page, x, y, width, height }` (page from 0, points): for
 * each, the pixels that differ and the largest cluster of them, and where it fit best (`offset`, points).
 */
export const compareRegions = (typst, other, regions) =>
  regions.map((r) => {
    const failed = {
      ...r,
      pixels: Number.POSITIVE_INFINITY,
      cluster: Number.POSITIVE_INFINITY,
      box: null,
      offset: null,
    };
    let a;
    try {
      a = raster(typst, r.page + 1, r.x, r.y, r.width, r.height);
    } catch {
      return failed;
    }
    // Where Typst drew it, and where it is on its page or the next when it isn't there.
    const here = compareAt(a, other, r, r.page, r.y, REACH.here) ?? failed;
    if (here.cluster <= TOLERANCE) return here;
    const [page, y] = locate(typst, other, r);
    if (page === r.page && Math.abs(y - r.y) <= REACH.here) return here;
    const there = compareAt(a, other, r, page, y, REACH.found) ?? failed;
    return there.cluster < here.cluster ? there : here;
  });

/** Region `r` (Typst's pixels `a`) compared with the other PDF's around `y` on `page`, `reach` points up or down. */
const compareAt = (a, other, r, page, y, reach) => {
  let b;
  try {
    b = raster(other, page + 1, r.x - REACH.x, y - reach, r.width + 2 * REACH.x, r.height + 2 * reach);
  } catch {
    return null;
  }
  // Typst's page coordinates, where the other's region is.
  b.y -= Math.round((y - r.y) * FINE);
  // The other's fine pixel under each of Typst's, moved by the offset.
  const under = (dx, dy) => [(u) => a.x + dx + u, (v) => a.y + dy + v];
  const [ox, oy] = offset(a, b, under);
  // Both averaged down to the compared resolution: `img`'s fine pixels from (x0, y0) of its raster, white outside it.
  const w = Math.floor(a.w / STEP);
  const h = Math.floor(a.h / STEP);
  const down = (img, x0, y0) => {
    const out = new Uint8Array(w * h * 3);
    const sum = new Float64Array(3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        sum.fill(0);
        for (let v = 0; v < STEP; v++) {
          const row = y0 + y * STEP + v;
          for (let u = 0; u < STEP; u++) {
            const col = x0 + x * STEP + u;
            if (row < 0 || col < 0 || row >= img.h || col >= img.w) {
              sum[0] += 255;
              sum[1] += 255;
              sum[2] += 255;
              continue;
            }
            const i = (row * img.w + col) * 3;
            sum[0] += img.data[i];
            sum[1] += img.data[i + 1];
            sum[2] += img.data[i + 2];
          }
        }
        const o = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(sum[c] / (STEP * STEP));
      }
    return out;
  };
  const pa = down(a, 0, 0);
  const pb = down(b, a.x + ox - b.x, a.y + oy - b.y);
  const at = (x, y) => (y * w + x) * 3;
  const around = (p, q, x, y) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const u = x + dx;
        const v = y + dy;
        if (u >= 0 && v >= 0 && u < w && v < h && near(p, at(x, y), q, at(u, v))) return true;
      }
    return false;
  };
  const differ = new Uint8Array(w * h);
  const found = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (near(pa, at(x, y), pb, at(x, y))) continue;
      if (around(pa, pb, x, y) && around(pb, pa, x, y)) continue;
      differ[y * w + x] = 1;
      found.push(y * w + x);
    }
  let cluster = 0;
  let box = null;
  for (const first of found) {
    if (differ[first] !== 1) continue;
    differ[first] = 2;
    const stack = [first];
    let size = 0;
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
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
      // In points on Typst's page, for finding what differs.
      const pt = (v, o) => Math.round(v / SCALE + o);
      box = [pt(x0, r.x), pt(y0, r.y), pt(x1 + 1, r.x), pt(y1 + 1, r.y)];
    }
  }
  return {
    ...r,
    pixels: found.length,
    cluster,
    box,
    offset: [ox / FINE, y - r.y + oy / FINE],
    ...(page !== r.page ? { otherPage: page } : {}),
  };
};

/** How dark each pixel of a raster is, 0 for white. */
const darkness = (img) => {
  const out = new Int16Array(img.w * img.h);
  for (let i = 0; i < out.length; i++) out[i] = 765 - img.data[i * 3] - img.data[i * 3 + 1] - img.data[i * 3 + 2];
  return out;
};

/**
 * Where region `r` of Typst's page is on the other's page or the next, to a point (both at a pixel per point): `[page,
 * y]` where its pixels differ least from Typst's, nearest Typst's place when two fit as well.
 */
const locate = (typst, other, r) => {
  const a = raster(typst, r.page + 1, r.x, r.y, r.width, r.height, 1);
  const ref = darkness(a);
  let best = [r.page, r.y, Number.POSITIVE_INFINITY];
  for (const page of [r.page, r.page + 1]) {
    let b;
    try {
      b = raster(other, page + 1, r.x, 0, r.width, 2000, 1);
    } catch {
      continue;
    }
    const band = darkness(b);
    const w = Math.min(a.w, b.w);
    // Nearest Typst's place first, so a later place that fits only as well doesn't win.
    const ys = Array.from({ length: Math.max(0, b.h - a.h + 1) }, (_, y) => y).sort(
      (p, q) => Math.abs(p - (page === r.page ? r.y : 0)) - Math.abs(q - (page === r.page ? r.y : 0)),
    );
    for (const y of ys) {
      let cost = 0;
      for (let v = 0; v < a.h && cost < best[2]; v++)
        for (let u = 0; u < w; u++) cost += Math.abs(ref[v * a.w + u] - band[(y + v) * b.w + u]);
      if (cost < best[2]) best = [page, y, cost];
    }
  }
  return [best[0], best[1]];
};

/**
 * Where Typst's region `a` fits best in the other's raster `b`, as `[dx, dy]` fine pixels: rows by how much ink each
 * has, then columns, each moved to where they differ least. `under(dx, dy)` maps a fine pixel of `a` to `b`'s.
 */
const offset = (a, b, under) => {
  const best = (ref, reach, other) => {
    let found = [0, Number.POSITIVE_INFINITY];
    for (let d = -reach; d <= reach; d++) {
      let cost = 0;
      for (let k = 0; k < ref.length && cost < found[1]; k++) cost += Math.abs(ref[k] - other(d, k));
      // Ties go to the smaller move.
      if (cost < found[1] || (cost === found[1] && Math.abs(d) < Math.abs(found[0]))) found = [d, cost];
    }
    return found[0];
  };
  // Ink per row of Typst's region, and per row of the other's raster across the columns the region would cover.
  const [bx0, by0] = under(0, 0);
  const rowsA = Array.from({ length: a.h }, (_, v) => {
    let sum = 0;
    for (let u = 0; u < a.w; u += 2) sum += ink(a, a.x + u, a.y + v);
    return sum;
  });
  const rowsB = new Map();
  const rowB = (y) => {
    if (!rowsB.has(y)) {
      let sum = 0;
      for (let u = 0; u < a.w; u += 2) sum += ink(b, bx0(u), y);
      rowsB.set(y, sum);
    }
    return rowsB.get(y);
  };
  // As far as the other's raster reaches past Typst's region.
  const reach = Math.max(0, Math.round((b.h - a.h) / 2));
  const dy = best(rowsA, reach, (d, v) => rowB(by0(v) + d));
  // Then columns, with the rows that fit.
  const [, by] = under(0, dy);
  const colsA = Array.from({ length: a.w }, (_, u) => {
    let sum = 0;
    for (let v = 0; v < a.h; v += 2) sum += ink(a, a.x + u, a.y + v);
    return sum;
  });
  const colsB = new Map();
  const colB = (x) => {
    if (!colsB.has(x)) {
      let sum = 0;
      for (let v = 0; v < a.h; v += 2) sum += ink(b, x, by(v));
      colsB.set(x, sum);
    }
    return colsB.get(x);
  };
  const dx = best(colsA, REACH.x * FINE, (d, u) => colB(bx0(u) + d));
  return [dx, dy];
};
