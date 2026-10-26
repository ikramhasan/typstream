// The prefix compile rate (PLAN.md §1) and per-class counts, from classified prefix results.
import { ERROR_CLASSES, type ErrorClass } from "./classify";

export interface ClassifiedPrefix {
  doc: string;
  cut: number;
  /** Arrival time of the prefix's last chunk (ms), when the stream has timings. */
  t?: number;
  /** Errors of the healed prefix (heal alone, before Layer 3). */
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
  /** For failures: fix rounds after which the engine's Layer 3 fixers (#20) made it compile (1–2), or null. */
  fixedIn?: number | null;
  /** For failures: fix rounds the engine ran (extra compiles), whether or not they fixed it. */
  fixRounds?: number;
  /** For failures: time the engine spent in fixers and their recompiles (ms). */
  fixMs?: number;
  /**
   * For failures Layer 3 leaves: what Layer 4 (#21) rendered, asked for the
   * stable prefix: isolated blocks, the stable prefix, the fixers again on
   * another round, or nothing (`null`).
   */
  fallback?: "isolated" | "stable-prefix" | "fixed" | null;
  example?: string;
}

export interface ClassStats {
  cls: ErrorClass;
  /** Prefixes with at least one error of this class. */
  prefixes: number;
  /** ... where it is the only class. */
  only: number;
  /** ... that still fail after Layer 3. */
  unfixed: number;
  /** Errors of this class in the unsettled tail / at the cut, as shares of its errors. */
  inTail: number;
  atCut: number;
  example?: string;
}

interface StaleRun {
  doc: string;
  ms: number;
  prefixes: number;
}

export interface Stats {
  prefixes: number;
  /** Prefixes that compile with heal alone. */
  compiling: number;
  rate: number;
  /** Prefixes that compile with Layer 3 (heal alone, or fixed). */
  fixed: number;
  fixedRate: number;
  /** Prefixes with an artifact once Layer 4 joins (asked for the stable prefix), and how Layer 4 made them. */
  rendered: number;
  renderedRate: number;
  byFallback: { isolated: number; stablePrefix: number };
  classes: ClassStats[];
  /** Failing prefixes whose errors are all in the unsettled tail. */
  allInTail: number;
  /** Failing prefixes whose settled part compiles. */
  stableOk: number;
  /** Failing prefixes Layer 3 fixes within 1 and 2 rounds. */
  fixedWithin: [number, number];
  /** Fix rounds run, i.e. compiles beyond one per prefix. */
  fixRounds: number;
  /** Median and 95th percentile of the time fixing took, over failing prefixes (ms). */
  fixMs: { p50: number; p95: number };
  /** Longest run of consecutive failing prefixes in one document, in ms of stream time: heal alone, and with Layer 3. */
  longestStale: StaleRun;
  longestStaleFixed: StaleRun;
}

/** Longest run of consecutive prefixes of one document for which `fails` holds. */
const longestRun = (results: readonly ClassifiedPrefix[], fails: (r: ClassifiedPrefix) => boolean): StaleRun => {
  let longest = { doc: "", ms: 0, prefixes: 0 };
  let run: ClassifiedPrefix[] = [];
  const close = (next?: ClassifiedPrefix) => {
    const first = run[0];
    // Stale from the first failure until the next compiling prefix arrives.
    const end = next?.doc === first?.doc ? next?.t : run.at(-1)?.t;
    if (first?.t !== undefined && end !== undefined && end - first.t > longest.ms) {
      longest = { doc: first.doc, ms: end - first.t, prefixes: run.length };
    }
    run = [];
  };
  for (const r of results) {
    if (run.length > 0 && r.doc !== run[0]?.doc) close();
    if (fails(r)) run.push(r);
    else if (run.length > 0) close(r);
  }
  close();
  return longest;
};

const percentile = (failing: readonly ClassifiedPrefix[], q: number): number => {
  const ms = failing.map((r) => r.fixMs ?? 0).sort((a, b) => a - b);
  return ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0;
};

const fails = (r: ClassifiedPrefix) => r.errors.length > 0;
const failsFixed = (r: ClassifiedPrefix) => r.errors.length > 0 && r.fixedIn == null;

export const stats = (results: readonly ClassifiedPrefix[]): Stats => {
  const failing = results.filter(fails);
  const classes = ERROR_CLASSES.map((cls) => {
    const hit = failing.filter((r) => r.errors.some((e) => e.cls === cls));
    const only = hit.filter((r) => r.errors.every((e) => e.cls === cls));
    const errors = hit.flatMap((r) => r.errors.filter((e) => e.cls === cls));
    return {
      cls,
      prefixes: hit.length,
      only: only.length,
      unfixed: hit.filter(failsFixed).length,
      inTail: errors.filter((e) => e.inTail).length / Math.max(errors.length, 1),
      atCut: errors.filter((e) => e.atCut).length / Math.max(errors.length, 1),
      example: hit[Math.floor(hit.length / 2)]?.example,
    };
  }).filter((c) => c.prefixes > 0);
  classes.sort((a, b) => b.prefixes - a.prefixes);

  const compiling = results.length - failing.length;
  const fixed = results.length - results.filter(failsFixed).length;
  const share = (n: number) => (results.length === 0 ? 1 : n / results.length);
  const unfixed = results.filter(failsFixed);
  const rendered = fixed + unfixed.filter((r) => r.fallback != null).length;
  return {
    prefixes: results.length,
    compiling,
    rate: share(compiling),
    fixed,
    fixedRate: share(fixed),
    rendered,
    renderedRate: share(rendered),
    byFallback: {
      isolated: unfixed.filter((r) => r.fallback === "isolated").length,
      stablePrefix: unfixed.filter((r) => r.fallback === "stable-prefix").length,
    },
    classes,
    allInTail: failing.filter((r) => r.errors.every((e) => e.inTail)).length,
    stableOk: failing.filter((r) => r.stableOk).length,
    fixedWithin: [1, 2].map((n) => failing.filter((r) => r.fixedIn != null && r.fixedIn <= n).length) as [
      number,
      number,
    ],
    fixRounds: failing.reduce((n, r) => n + (r.fixRounds ?? 0), 0),
    fixMs: { p50: percentile(failing, 0.5), p95: percentile(failing, 0.95) },
    longestStale: longestRun(results, fails),
    longestStaleFixed: longestRun(results, failsFixed),
  };
};

const pct = (n: number, d: number) => `${((100 * n) / Math.max(d, 1)).toFixed(2)}%`;
const stale = (r: StaleRun) => `${(r.ms / 1000).toFixed(1)} s (${r.prefixes} prefixes, ${r.doc || "none"})`;

/** A Markdown summary: the rates, then one row per class. */
export const formatStats = (title: string, s: Stats): string => {
  const failing = s.prefixes - s.compiling;
  const [one, two] = s.fixedWithin;
  const lines = [
    `### ${title}`,
    "",
    `Prefix compile rate with Layer 3: **${pct(s.fixed, s.prefixes)}** (${s.fixed} / ${s.prefixes}); ` +
      `heal alone: ${pct(s.compiling, s.prefixes)}. ` +
      `Of ${failing} failing prefixes, Layer 3 fixes ${pct(one, failing)} in 1 round and ${pct(two, failing)} within 2, ` +
      `running ${s.fixRounds} extra compiles (${pct(s.fixRounds, s.prefixes)} of prefixes; ` +
      `fixing took p50 ${s.fixMs.p50.toFixed(1)} ms, p95 ${s.fixMs.p95.toFixed(1)} ms). ` +
      `Longest stale run: ${stale(s.longestStaleFixed)}; heal alone: ${stale(s.longestStale)}.`,
    "",
    `With Layer 4 (the stable prefix asked for): **${pct(s.rendered, s.prefixes)}** of prefixes render ` +
      `(${s.prefixes - s.fixed} left by Layer 3: ${s.byFallback.stablePrefix} as the stable prefix, ` +
      `${s.byFallback.isolated} with isolated blocks).`,
  ];
  if (s.stableOk > 0) {
    lines.push(
      "",
      `Heal alone: ${pct(s.allInTail, failing)} of failures have every error in the unsettled tail; ` +
        `the settled part compiles alone for ${pct(s.stableOk, failing)}.`,
    );
  }
  lines.push(
    "",
    "| Class | Prefixes | Share of all | Only class | Still failing after Layer 3 | In tail | At cut | Example (input tail → first error) |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...s.classes.map(
      (c) =>
        `| ${c.cls} | ${c.prefixes} | ${pct(c.prefixes, s.prefixes)} | ${c.only} | ${c.unfixed} | ${pct(c.inTail, 1)} | ${pct(c.atCut, 1)} | ${(c.example ?? "").replace(/\|/g, "\\|")} |`,
    ),
  );
  return lines.join("\n");
};
