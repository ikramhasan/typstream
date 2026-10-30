// The colours of words against Typst's PDF (#118): the paper behind each word (a highlight, a shaded box, a cell's
// fill) and the ink of its glyphs (coloured text). The lines compare text and places, and the ink check what pages draw
// darker than a light grey besides text: a highlight Word lost, red text come out black, would pass both.
//
// Both PDFs are rasterized by poppler at 2 pixels per point. Each word of Typst's (`pdftotext`'s boxes) is matched to
// the same word in the other PDF on the same page, near where Typst set it; words in pictures (compared by pixels.mjs)
// and in equations (each engine sets math its own way, and LibreOffice draws equations black, #132) are left out.
import { execFileSync } from "node:child_process";
import { mathBoxes, pageCount } from "./lines.mjs";

const SCALE = 2;
/** How far, in points, the other PDF's word may be from Typst's to be the same word. */
const NEAR = 6;
/**
 * Largest channel difference two papers or two inks may have: antialiasing and colour management move a colour by a
 * few levels, a lost highlight or a red word come out black by a hundred or more.
 */
export const COLOUR_TOLERANCE = 48;

const WORD = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
const PAGE = /<page [^>]*>([\s\S]*?)<\/page>/g;

/** Each page's words: `[x0, y0, x1, y1, text]` in points. */
const words = (pdf) =>
  [
    ...execFileSync("pdftotext", ["-bbox", pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "ignore"],
    }).matchAll(PAGE),
  ].map(([, page]) => [...page.matchAll(WORD)].map((m) => [...m.slice(1, 5).map(Number), m[5]]));

/** Page `n` (from 1) as RGB pixels at `SCALE` per point. */
const rgb = (pdf, n) => {
  const ppm = execFileSync("pdftoppm", ["-r", String(72 * SCALE), "-f", String(n), "-l", String(n), pdf], {
    maxBuffer: 1 << 30,
  });
  let at = 0;
  const fields = [];
  while (fields.length < 4) {
    while (ppm[at] === 0x20 || ppm[at] === 0x0a) at++;
    const start = at;
    while (ppm[at] !== 0x20 && ppm[at] !== 0x0a) at++;
    fields.push(ppm.toString("latin1", start, at));
  }
  return { w: Number(fields[1]), h: Number(fields[2]), data: ppm.subarray(at + 1) };
};

/**
 * A word's paper (its box's most common colour, in steps of 16) and ink (the mean of its darkest tenth of pixels,
 * its glyphs' cores), as `[r, g, b]`.
 */
const colours = (img, [x0, y0, x1, y1]) => {
  const px = [];
  for (let y = Math.max(0, Math.floor(y0 * SCALE)); y < Math.min(img.h, Math.ceil(y1 * SCALE)); y++)
    for (let x = Math.max(0, Math.floor(x0 * SCALE)); x < Math.min(img.w, Math.ceil(x1 * SCALE)); x++) {
      const i = (y * img.w + x) * 3;
      px.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  if (!px.length) return null;
  const counts = new Map();
  for (const [r, g, b] of px) {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const paper = [((top >> 8) & 15) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8];
  const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
  const dark = px.sort((a, b) => luma(a) - luma(b)).slice(0, Math.max(1, Math.round(px.length / 10)));
  const ink = [0, 1, 2].map((c) => Math.round(dark.reduce((s, p) => s + p[c], 0) / dark.length));
  return { paper, ink };
};

const hex = (c) => c.map((v) => v.toString(16).padStart(2, "0")).join("");
const far = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) > COLOUR_TOLERANCE;

/**
 * Typst's words found in the other PDF, and those whose paper or ink differ: `{ words, differing, first }`, `first`
 * the first that differs (`{ page, text, paper: [typst, other], ink: [typst, other] }`, hex RGB; page from 1), or
 * null. `regions` are pictures (`{ page, x, y, width, height }`, page from 0) left out. Without `ink`, papers only: in
 * other scripts Typst draws a mark as a piece of its own (#134), whose box is mostly its edges.
 */
export const compareColours = (typst, other, { regions = [], ink = true } = {}) => {
  const [a, b] = [words(typst), words(other)];
  const masks = [...regions, ...mathBoxes(typst), ...mathBoxes(other)];
  const masked = (page, [x0, y0, x1, y1]) => {
    const [x, y] = [(x0 + x1) / 2, (y0 + y1) / 2];
    return masks.some((r) => r.page === page && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
  };
  let count = 0;
  let differing = 0;
  let first = null;
  for (let n = 1; n <= Math.min(pageCount(typst), pageCount(other)); n++) {
    const theirs = (b[n - 1] ?? []).filter((w) => !masked(n - 1, w));
    const ours = (a[n - 1] ?? []).filter((w) => !masked(n - 1, w) && w[4].trim());
    if (!ours.length) continue;
    const [imgA, imgB] = [rgb(typst, n), rgb(other, n)];
    const used = new Set();
    for (const w of ours) {
      const k = theirs.findIndex(
        (v, i) => !used.has(i) && v[4] === w[4] && Math.abs(v[0] - w[0]) < NEAR && Math.abs(v[3] - w[3]) < NEAR,
      );
      if (k < 0) continue;
      used.add(k);
      const [p, q] = [colours(imgA, w), colours(imgB, theirs[k])];
      if (!p || !q) continue;
      count++;
      // Ink only where the word has a letter or digit: a lone bar or dot is all antialiased edge.
      if (far(p.paper, q.paper) || (ink && /[\p{L}\p{N}]/u.test(w[4]) && far(p.ink, q.ink))) {
        differing++;
        first ??= { page: n, text: w[4], paper: [hex(p.paper), hex(q.paper)], ink: [hex(p.ink), hex(q.ink)] };
      }
    }
  }
  return { words: count, differing, first };
};
