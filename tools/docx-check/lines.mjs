// Lines of a PDF as `pdftotext -bbox` reads them, and how many of Typst's another layout reproduces (#118's spike,
// spikes/docx/run.py).
import { execFileSync } from "node:child_process";

const PAGE = /<page [^>]*>([\s\S]*?)<\/page>/g;
const WORD = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
const unescape = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) =>
    e === "amp" ? "&" : e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(Number(e.slice(1))),
  );

/**
 * Whether a box (page from 1, points) is in one of `regions` (`{ page, x, y, width, height }`, page from 0): text
 * drawn in a picture, which a DOCX has as outlines (#133).
 */
const pictured = (regions, n, x0, y0, x1, y1) => {
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  return regions.some((r) => r.page === n - 1 && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
};

/** [page, "words of the line"], lines by the bottom of their words' boxes, top to bottom; none in `regions`. */
export const linesOf = (pdf, regions = []) => {
  const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const out = [];
  let n = 0;
  for (const [, page] of xml.matchAll(PAGE)) {
    n++;
    const words = [];
    for (const [, x0, y0, x1, y1, w] of page.matchAll(WORD)) {
      const t = unescape(w).normalize("NFKC");
      if (t && !pictured(regions, n, Number(x0), Number(y0), Number(x1), Number(y1))) words.push([Number(y1), Number(x0), t]);
    }
    words.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lines = [];
    for (const [y, x, t] of words) {
      const last = lines.at(-1);
      if (last && Math.abs(last[0] - y) < 3) last[1].push([x, t]);
      else lines.push([y, [[x, t]]]);
    }
    for (const [, ws] of lines) out.push([n, ws.sort((a, b) => a[0] - b[0]).map((w) => w[1]).join(" ")]);
  }
  return out;
};

/** Faces equations are set in: Typst's, and what an engine typesets OMML with besides. */
const MATH_FONT = /Math|OpenSymbol|Cambria/i;
const TEXT = /<text top="([\d.-]+)" left="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" font="(\d+)">([\s\S]*?)<\/text>/g;
const FONTSPEC = /<fontspec id="(\d+)" size="[^"]*" family="([^"]*)"/g;

/** A face's family without its subset tag, spaces or style: what two PDFs of the same text share. */
const face = (family) =>
  family
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/[\s_-]/g, "")
    .replace(/(Bold|Italic|Regular|Book|Medium|Semibold)+$/i, "")
    .toLowerCase();

/** The faces a PDF sets its text (not its math) in. */
export const textFaces = (pdf) => new Set(pieces(pdf).filter((p) => !p[5]).map((p) => p[6]));

/**
 * Text pieces in one face each (`pdftohtml -xml`), in points: [page, top, left, bottom, text, math, face]. With
 * `faces`, text in any other face is math too: an engine missing the math font a character asks for falls back to
 * whatever face has it (ONLYOFFICE draws operators so).
 */
const pieces = (pdf, faces, regions = []) => {
  const xml = execFileSync("pdftohtml", ["-xml", "-i", "-zoom", "1", "-stdout", pdf], { encoding: "utf8", maxBuffer: 1 << 28 });
  const families = new Map();
  const out = [];
  let n = 0;
  for (const page of xml.split(/<page /).slice(1)) {
    n++;
    for (const [, id, family] of page.matchAll(FONTSPEC)) families.set(id, family);
    for (const [, top, left, width, height, font, raw] of page.matchAll(TEXT)) {
      const text = unescape(raw.replace(/<[^>]*>/g, "")).normalize("NFKC");
      const family = families.get(font) ?? "";
      const math = MATH_FONT.test(family) || (faces !== undefined && !faces.has(face(family)));
      const [y0, x0, y1] = [Number(top), Number(left), Number(top) + Number(height)];
      if (text.trim() && !pictured(regions, n, x0, y0, x0 + Number(width), y1))
        out.push([n, y0, x0, y1, text, math, face(family)]);
    }
  }
  return out;
};

/**
 * Lines of a PDF with equations, without them: each program sets math its own way (LibreOffice in formula objects of
 * its own spacing, every engine stacking fractions apart), so lines are compared by their text around it.
 */
export const textLinesOf = (pdf, faces, regions = []) => {
  const out = [];
  const byPage = new Map();
  for (const p of pieces(pdf, faces, regions).filter((p) => !p[5])) byPage.set(p[0], [...(byPage.get(p[0]) ?? []), p]);
  for (const [n, ps] of byPage) {
    // Pieces in different sizes share a line when their boxes mostly overlap (their bottoms differ with the size).
    ps.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    const lines = [];
    for (const p of ps) {
      const overlap = (l) => Math.min(l.bottom, p[3]) - Math.max(l.top, p[1]);
      const line = lines.find((l) => overlap(l) >= 0.5 * Math.min(l.bottom - l.top, p[3] - p[1]));
      if (line) {
        line.pieces.push(p);
        line.top = Math.min(line.top, p[1]);
        line.bottom = Math.max(line.bottom, p[3]);
      } else lines.push({ top: p[1], bottom: p[3], pieces: [p] });
    }
    lines.sort((a, b) => a.bottom - b.bottom);
    for (const l of lines) out.push([n, l.pieces.sort((a, b) => a[2] - b[2]).map((p) => p[4]).join(" ")]);
  }
  return out;
};

/** The letters and digits of a PDF's equations, in order: whether every equation came out. */
export const mathOf = (pdf, regions = []) =>
  pieces(pdf, undefined, regions)
    .filter((p) => p[5])
    .map((p) => p[4].replace(/[^\p{L}\p{N}]/gu, ""))
    .join("");

/** How many of `ref`'s characters `got` has, as multisets. */
export const sharedChars = (ref, got) => {
  const count = new Map();
  for (const c of got) count.set(c, (count.get(c) ?? 0) + 1);
  let n = 0;
  for (const c of ref) {
    const k = count.get(c) ?? 0;
    if (k > 0) {
      n++;
      count.set(c, k - 1);
    }
  }
  return n;
};

/** Longest common subsequence length of two arrays of strings. */
const lcs = (a, b) => {
  let prev = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
};

/** How much of `ref` (Typst's lines) `got` reproduces: lines in order, and the lines pages start with. */
export const compare = (ref, got) => {
  // Whitespace aside: which words share a line doesn't depend on it. So are a leader's dots (an outline's, a tab's in
  // Word): how many fit depends on the dots' spacing.
  const key = (t) => t.replace(/\s+/g, "").replace(/\.{3,}/g, "…");
  const a = ref.map(([, t]) => key(t));
  const b = got.map(([, t]) => key(t));
  const same = lcs(a, b);
  const starts = (ls, keys) => keys.filter((_, i) => i === 0 || ls[i - 1][0] !== ls[i][0]);
  const startsRef = starts(ref, a);
  const startsGot = new Set(starts(got, b));
  let first = null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      first = { typst: a.slice(i, i + 2), other: b.slice(i, i + 2) };
      break;
    }
  }
  return {
    lines: a.length,
    same,
    pages: [ref.at(-1)?.[0] ?? 0, got.at(-1)?.[0] ?? 0],
    pageStarts: startsRef.length,
    pageStartsSame: startsRef.filter((t) => startsGot.has(t)).length,
    first,
  };
};
