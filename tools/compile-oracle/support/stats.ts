// The prefix compile rate (PLAN.md §1) and per-class counts, from classified prefix results.
import { ERROR_CLASSES, type ErrorClass } from "./classify";

export interface ClassifiedPrefix {
  doc: string;
  cut: number;
  /** Arrival time of the prefix's last chunk (ms), when the stream has timings. */
  t?: number;
  errors: {
    cls: ErrorClass;
    message: string;
    /** The error lies after the stable offset, in the unsettled tail. */
    inTail: boolean;
    /** Only closers healing appended follow the error: it is in the value being typed. */
    atCut: boolean;
  }[];
  /** For failures (research runs): the settled part alone compiles (§5.6 level 2 would show it). */
  stableOk?: boolean;
  /** For failures (research runs): rounds the simulated Layer 3 fixers needed (1–3), or null. */
  fixedIn?: number | null;
  example?: string;
}

export interface ClassStats {
  cls: ErrorClass;
  /** Prefixes with at least one error of this class. */
  prefixes: number;
  /** ... where it is the only class. */
  only: number;
  /** Errors of this class in the unsettled tail / at the cut, as shares of its errors. */
  inTail: number;
  atCut: number;
  example?: string;
}

export interface Stats {
  prefixes: number;
  compiling: number;
  rate: number;
  classes: ClassStats[];
  /** Failing prefixes whose errors are all in the unsettled tail. */
  allInTail: number;
  /** Failing prefixes whose settled part compiles. */
  stableOk: number;
  /** Failing prefixes the simulated fixers fix within 1, 2 and 3 rounds. */
  fixedWithin: [number, number, number];
  /** Longest run of consecutive failing prefixes in one document, in ms of stream time. */
  longestStaleMs: { doc: string; ms: number; prefixes: number };
}

export const stats = (results: readonly ClassifiedPrefix[]): Stats => {
  const failing = results.filter((r) => r.errors.length > 0);
  const classes = ERROR_CLASSES.map((cls) => {
    const hit = failing.filter((r) => r.errors.some((e) => e.cls === cls));
    const only = hit.filter((r) => r.errors.every((e) => e.cls === cls));
    const errors = hit.flatMap((r) => r.errors.filter((e) => e.cls === cls));
    return {
      cls,
      prefixes: hit.length,
      only: only.length,
      inTail: errors.filter((e) => e.inTail).length / Math.max(errors.length, 1),
      atCut: errors.filter((e) => e.atCut).length / Math.max(errors.length, 1),
      example: hit[Math.floor(hit.length / 2)]?.example,
    };
  }).filter((c) => c.prefixes > 0);
  classes.sort((a, b) => b.prefixes - a.prefixes);

  let longestStaleMs = { doc: "", ms: 0, prefixes: 0 };
  let run: ClassifiedPrefix[] = [];
  const close = (next?: ClassifiedPrefix) => {
    const first = run[0];
    // Stale from the first failure until the next compiling prefix arrives.
    const end = next?.doc === first?.doc ? next?.t : run.at(-1)?.t;
    if (first?.t !== undefined && end !== undefined && end - first.t > longestStaleMs.ms) {
      longestStaleMs = { doc: first.doc, ms: end - first.t, prefixes: run.length };
    }
    run = [];
  };
  for (const r of results) {
    if (run.length > 0 && r.doc !== run[0]?.doc) close();
    if (r.errors.length > 0) run.push(r);
    else if (run.length > 0) close(r);
  }
  close();

  return {
    prefixes: results.length,
    compiling: results.length - failing.length,
    rate: results.length === 0 ? 1 : (results.length - failing.length) / results.length,
    classes,
    allInTail: failing.filter((r) => r.errors.every((e) => e.inTail)).length,
    stableOk: failing.filter((r) => r.stableOk).length,
    fixedWithin: [1, 2, 3].map((n) => failing.filter((r) => r.fixedIn != null && r.fixedIn <= n).length) as [
      number,
      number,
      number,
    ],
    longestStaleMs,
  };
};

const pct = (n: number, d: number) => `${((100 * n) / Math.max(d, 1)).toFixed(2)}%`;

/** A Markdown summary: the rate, then one row per class. */
export const formatStats = (title: string, s: Stats): string => {
  const failing = s.prefixes - s.compiling;
  const research = s.fixedWithin[2] > 0 || s.stableOk > 0;
  const lines = [
    `### ${title}`,
    "",
    `Prefix compile rate: **${pct(s.compiling, s.prefixes)}** (${s.compiling} / ${s.prefixes}). ` +
      `Of ${failing} failing prefixes, ${pct(s.allInTail, failing)} have every error in the unsettled tail. ` +
      `Longest stale run: ${(s.longestStaleMs.ms / 1000).toFixed(1)} s (${s.longestStaleMs.prefixes} prefixes, ${s.longestStaleMs.doc}).`,
  ];
  if (research) {
    const [one, two, three] = s.fixedWithin;
    lines.push(
      "",
      `Settled part compiles alone: ${pct(s.stableOk, failing)} of failures. ` +
        `Simulated fixers fix ${pct(one, failing)} in 1 round, ${pct(two, failing)} in 2, ${pct(three, failing)} in 3: ` +
        `rate with 2 rounds **${pct(s.compiling + two, s.prefixes)}**.`,
    );
  }
  lines.push(
    "",
    "| Class | Prefixes | Share of all | Only class | In tail | At cut | Example (input tail → first error) |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...s.classes.map(
      (c) =>
        `| ${c.cls} | ${c.prefixes} | ${pct(c.prefixes, s.prefixes)} | ${c.only} | ${pct(c.inTail, 1)} | ${pct(c.atCut, 1)} | ${(c.example ?? "").replace(/\|/g, "\\|")} |`,
    ),
  );
  return lines.join("\n");
};
