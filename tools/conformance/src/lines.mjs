// Lines of a PDF as `pdftotext -bbox` reads them, and how many of Typst's another layout reproduces (#118's spike,
// spikes/docx/run.py; tools/docx-check, #131, and the conformance suite, #135).
import { execFileSync } from "node:child_process";

const PAGE = /<page [^>]*>([\s\S]*?)<\/page>/g;
const WORD = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
const decode = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) =>
    e === "amp"
      ? "&"
      : e === "lt"
        ? "<"
        : e === "gt"
          ? ">"
          : e === "quot"
            ? '"'
            : e === "apos"
              ? "'"
              : String.fromCodePoint(Number(e.slice(1))),
  );

/**
 * A word's or piece's text as compared: NFKC, without format characters (a word joiner a DOCX export writes to keep a
 * blank's underline, which ONLYOFFICE's PDF keeps as text) or emoji, which no engine here has a font for: Typst draws
 * a missing glyph's box and leaves it out of its PDF's text, LibreOffice draws nothing and keeps it. Only characters
 * shown as emoji by default (💡): ©, ™, arrows, ☑ or ⚠ are pictographic too, but Typst's fonts draw them.
 */
const plain = (raw) =>
  decode(raw)
    .normalize("NFKC")
    .replace(/\p{Cf}|\p{Emoji_Presentation}/gu, "");

/** `pdftotext -bbox`'s XML of a PDF: its words' boxes, page by page. */
const bbox = (pdf) =>
  execFileSync("pdftotext", ["-bbox", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** Each page's words' boxes, `[x0, y0, x1, y1]` in points, from page 1. */
export const wordBoxes = (pdf) =>
  [...bbox(pdf).matchAll(PAGE)].map(([, page]) => [...page.matchAll(WORD)].map((m) => m.slice(1, 5).map(Number)));

/** A PDF's page count. */
export const pageCount = (pdf) =>
  Number(/^Pages:\s+(\d+)/m.exec(execFileSync("pdfinfo", [pdf], { encoding: "utf8" }))?.[1] ?? 0);

/** The boxes of a PDF's equations' pieces, `{ page, x, y, width, height }` (page from 0, points). */
export const mathBoxes = (pdf) =>
  pieces(pdf)
    .filter((p) => p[5])
    .map(([n, y0, x0, y1, , , , width]) => ({ page: n - 1, x: x0, y: y0, width, height: y1 - y0, math: true }));

/**
 * Whether a box (page from 1, points) is in one of `regions` (`{ page, x, y, width, height }`, page from 0): text
 * drawn in a picture, which a DOCX has as outlines (#133).
 */
const pictured = (regions, n, x0, y0, x1, y1) => {
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  return regions.some((r) => r.page === n - 1 && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
};

/**
 * [page, "words of the line", bottom, left], lines by the bottom of their words' boxes (points), top to bottom; none in
 * `regions`.
 */
export const linesOf = (pdf, regions = []) => {
  const xml = bbox(pdf);
  const out = [];
  let n = 0;
  for (const [, page] of xml.matchAll(PAGE)) {
    n++;
    const words = [];
    for (const [, x0, y0, x1, y1, w] of page.matchAll(WORD)) {
      const t = plain(w);
      if (t && !pictured(regions, n, Number(x0), Number(y0), Number(x1), Number(y1)))
        words.push([Number(y1), Number(x0), t]);
    }
    words.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lines = [];
    for (const [y, x, t] of words) {
      const last = lines.at(-1);
      if (last && Math.abs(last[0] - y) < 3) last[1].push([x, t]);
      else lines.push([y, [[x, t]]]);
    }
    for (const [y, ws] of lines) {
      ws.sort((a, b) => a[0] - b[0]);
      out.push([n, ws.map((w) => w[1]).join(" "), y, ws[0][0]]);
    }
  }
  return out;
};

/**
 * How far, in points, another layout may set a line from where Typst set it (`drift`). Engines round glyph advances
 * (LibreOffice to twips), which moves a right-aligned line's start by up to about 2 points; a gap Word lost moves every
 * line after it by the gap.
 */
export const DRIFT_TOLERANCE = 3;

/**
 * How far another layout's lines are from Typst's (`linesOf`'s, each matched to the next of the same text on the same
 * page): the farthest, `{ distance, dy, dx, page, text }` in points (page from 1), or null when none match. Lines with
 * the same words can still be in the wrong place: below a gap that was lost, or beside a label Word centred with them.
 */
export const drift = (ref, got) => {
  const key = (t) => t.replace(/\s+/g, "").replace(/\.{3,}/g, "…");
  let worst = null;
  let j = 0;
  for (const [page, text, y, x] of ref) {
    const k = got.findIndex((l, i) => i >= j && l[0] === page && key(l[1]) === key(text));
    if (k < 0) continue;
    j = k + 1;
    const [dy, dx] = [got[k][2] - y, got[k][3] - x];
    const distance = Math.max(Math.abs(dy), Math.abs(dx));
    if (!worst || distance > worst.distance) worst = { distance, dy, dx, page, text };
  }
  return worst;
};

/**
 * [page, { text, x0, x1 }] for scripts whose text a PDF doesn't keep as written (#134), top to bottom; none in
 * `regions`. Typst draws a mark (an Arabic dot, an Indic vowel sign) as an item of its own, which its PDF gives the text
 * of the letter it sits on again, a little above or below it (as a word of no width, or inside the word); ONLYOFFICE's
 * PDF drops Indic vowel signs. So words share a line when their boxes mostly overlap, words of no width are left out,
 * a line's text has repeats collapsed (`collapsed`), and two lines are the same when their text or where their ink
 * starts and ends is (`sameLine`): a line broken elsewhere has neither.
 */
export const scriptLinesOf = (pdf, regions = []) => {
  const xml = bbox(pdf);
  const out = [];
  let n = 0;
  for (const [, page] of xml.matchAll(PAGE)) {
    n++;
    const words = [];
    for (const [, x0, y0, x1, y1, w] of page.matchAll(WORD)) {
      const t = plain(w);
      // A mark's word has no width (Typst's).
      if (
        t.trim() &&
        Number(x1) - Number(x0) > 0.01 &&
        !pictured(regions, n, Number(x0), Number(y0), Number(x1), Number(y1))
      )
        words.push([Number(y0), Number(y1), Number(x0), t]);
    }
    words.sort((a, b) => a[1] - b[1]);
    const lines = [];
    for (const [y0, y1, x, t] of words) {
      const overlap = (l) => Math.min(l.y1, y1) - Math.max(l.y0, y0);
      const line = lines.find((l) => overlap(l) >= 0.6 * Math.min(l.y1 - l.y0, y1 - y0));
      if (line) line.words.push([x, t]);
      else lines.push({ y0, y1, words: [[x, t]] });
    }
    lines.sort((a, b) => a.y1 - b.y1);
    const img = grey(pdf, n);
    for (const l of lines) {
      const text = collapsed(
        l.words
          .sort((a, b) => a[0] - b[0])
          .map((w) => w[1])
          .join(""),
      );
      out.push([n, { text, ...inked(img, l) }]);
    }
  }
  return out;
};

/** Pixels per point lines' ink is measured at. */
const INK_SCALE = 2;

/** Page `n` (from 1) of a PDF as grey pixels at `scale` per point. */
export const grey = (pdf, n, scale = INK_SCALE) => {
  const pgm = execFileSync("pdftoppm", ["-r", String(72 * scale), "-gray", "-f", String(n), "-l", String(n), pdf], {
    maxBuffer: 1 << 30,
  });
  // P5, width height, 255, then the pixels.
  let at = 0;
  const fields = [];
  while (fields.length < 4) {
    while (pgm[at] === 0x20 || pgm[at] === 0x0a) at++;
    const start = at;
    while (pgm[at] !== 0x20 && pgm[at] !== 0x0a) at++;
    fields.push(pgm.toString("latin1", start, at));
  }
  return { w: Number(fields[1]), h: Number(fields[2]), data: pgm.subarray(at + 1) };
};

/** Where a line's ink starts and ends, in points: in the middle of its box, which only its own glyphs reach. */
const inked = (img, line) => {
  const middle = (line.y1 - line.y0) * 0.3;
  let [x0, x1] = [img.w, -1];
  for (let y = Math.round((line.y0 + middle) * INK_SCALE); y <= Math.round((line.y1 - middle) * INK_SCALE); y++) {
    if (y < 0 || y >= img.h) continue;
    for (let x = 0; x < img.w; x++) {
      if (img.data[y * img.w + x] < 128) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
  }
  return { x0: x0 / INK_SCALE, x1: (x1 + 1) / INK_SCALE };
};

/** Whether two lines of `scriptLinesOf` are the same: their text, or their ink's extent to 3 points. */
export const sameLine = (a, b) => a.text === b.text || (Math.abs(a.x0 - b.x0) < 3 && Math.abs(a.x1 - b.x1) < 3);

/**
 * A line's text without whitespace, and with a syllable repeated right after itself once: a mark inside a word repeats
 * its letter in Typst's PDF, and a reordered Bengali `র্` repeats its syllable in both PDFs.
 */
const collapsed = (text) => text.replace(/\s+/g, "").replace(/(.{1,6}?)\1+/gu, "$1");

/** Faces equations are set in: Typst's, and what an engine typesets OMML with besides. */
const MATH_FONT = /Math|OpenSymbol|Cambria/i;
const TEXT =
  /<text top="([\d.-]+)" left="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" font="(\d+)">([\s\S]*?)<\/text>/g;
const FONTSPEC = /<fontspec id="(\d+)" size="[^"]*" family="([^"]*)"/g;

/** A face's family without its subset tag, spaces or style: what two PDFs of the same text share. */
const face = (family) =>
  family
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/[\s_-]/g, "")
    .replace(/(Bold|Italic|Regular|Book|Medium|Semibold)+$/i, "")
    .toLowerCase();

/** The faces a PDF sets its text (not its math) in. */
export const textFaces = (pdf) =>
  new Set(
    pieces(pdf)
      .filter((p) => !p[5])
      .map((p) => p[6]),
  );

/**
 * Text pieces in one face each (`pdftohtml -xml`), in points: [page, top, left, bottom, text, math, face, width]. With
 * `faces`, text in any other face is math too: an engine missing the math font a character asks for falls back to
 * whatever face has it (ONLYOFFICE draws operators so).
 */
const pieces = (pdf, faces, regions = []) => {
  const xml = execFileSync("pdftohtml", ["-xml", "-i", "-zoom", "1", "-stdout", pdf], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    // "no word list" for a page without text.
    stdio: ["ignore", "pipe", "ignore"],
  });
  const families = new Map();
  const out = [];
  let n = 0;
  for (const page of xml.split(/<page /).slice(1)) {
    n++;
    for (const [, id, family] of page.matchAll(FONTSPEC)) families.set(id, family);
    for (const [, top, left, width, height, font, raw] of page.matchAll(TEXT)) {
      const text = plain(raw.replace(/<[^>]*>/g, ""));
      const family = families.get(font) ?? "";
      const math = MATH_FONT.test(family) || (faces !== undefined && !faces.has(face(family)));
      const [y0, x0, y1] = [Number(top), Number(left), Number(top) + Number(height)];
      if (text.trim() && !pictured(regions, n, x0, y0, x0 + Number(width), y1))
        out.push([n, y0, x0, y1, text, math, face(family), Number(width)]);
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
    for (const l of lines)
      out.push([
        n,
        l.pieces
          .sort((a, b) => a[2] - b[2])
          .map((p) => p[4])
          .join(" "),
      ]);
  }
  return out;
};

/** The letters and digits of a PDF's equations, in order: whether every equation came out. */
export const mathOf = (pdf, regions = []) =>
  pieces(pdf, undefined, regions)
    .filter((p) => p[5])
    // Base letters: an accent is a piece of its own in another engine's PDF (`dot(x)` is "ẋ" in Typst's).
    .map((p) => p[4].normalize("NFD").replace(/[^\p{L}\p{N}]/gu, ""))
    .join("");

/**
 * How many times a PDF's text has "¿": what LibreOffice draws, in red, for an operand its math is missing (an operator
 * it took to need one). Typst's PDF has it only where the text does.
 */
export const missingOperands = (pdf) =>
  execFileSync("pdftotext", [pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "ignore"],
  }).split("\u00bf").length - 1;

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

/** Longest common subsequence length of two arrays, by `equal`. */
const lcs = (a, b, equal) => {
  let prev = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++)
      cur[j] = equal(a[i - 1], b[j - 1]) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
};

/**
 * How much of `ref` (Typst's lines) `got` reproduces: lines in order, and the lines pages start with. Lines are text, or
 * `scriptLinesOf`'s, compared by `sameLine`.
 */
export const compare = (ref, got, unmapped) => {
  // Whitespace aside: which words share a line doesn't depend on it. So are a leader's dots (an outline's, a tab's in
  // Word): how many fit depends on the dots' spacing. And what `unmapped` matches, on both sides: glyphs the other
  // PDF draws without text for them (Pages' ligatures).
  const text = (t) => (unmapped ? t.replace(unmapped, "") : t).replace(/\s+/g, "").replace(/\.{3,}/g, "…");
  const key = (t) => (typeof t === "string" ? text(t) : unmapped ? { ...t, text: text(t.text) } : t);
  const equal = (x, y) => (typeof x === "string" ? x === y : sameLine(x, y));
  const a = ref.map(([, t]) => key(t));
  const b = got.map(([, t]) => key(t));
  const same = lcs(a, b, equal);
  const starts = (ls, keys) => keys.filter((_, i) => i === 0 || ls[i - 1][0] !== ls[i][0]);
  const startsRef = starts(ref, a);
  const startsGot = starts(got, b);
  const show = (l) => (typeof l === "string" ? l : l.text);
  let first = null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined || b[i] === undefined || !equal(a[i], b[i])) {
      first = { typst: a.slice(i, i + 2).map(show), other: b.slice(i, i + 2).map(show) };
      break;
    }
  }
  return {
    lines: a.length,
    same,
    pages: [ref.at(-1)?.[0] ?? 0, got.at(-1)?.[0] ?? 0],
    pageStarts: startsRef.length,
    pageStartsSame: startsRef.filter((t) => startsGot.some((u) => equal(t, u))).length,
    first,
  };
};
