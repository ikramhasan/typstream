// Lines of a PDF as `pdftotext -bbox` reads them, and how many of Typst's another layout reproduces (#118's spike,
// spikes/docx/run.py).
import { execFileSync } from "node:child_process";

const PAGE = /<page [^>]*>([\s\S]*?)<\/page>/g;
const WORD = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
const unescape = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) =>
    e === "amp" ? "&" : e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(Number(e.slice(1))),
  );

/** [page, "words of the line"], lines by the bottom of their words' boxes, top to bottom. */
export const linesOf = (pdf) => {
  const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const out = [];
  let n = 0;
  for (const [, page] of xml.matchAll(PAGE)) {
    n++;
    const words = [];
    for (const [, x0, , , y1, w] of page.matchAll(WORD)) {
      const t = unescape(w).normalize("NFKC");
      if (t) words.push([Number(y1), Number(x0), t]);
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
  // Whitespace aside: which words share a line doesn't depend on it.
  const a = ref.map(([, t]) => t.replace(/\s+/g, ""));
  const b = got.map(([, t]) => t.replace(/\s+/g, ""));
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
