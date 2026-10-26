// Do healed prefixes compile? (#13, PLAN.md §5.5, §11.1.) Sampled stream
// prefixes of the corpus and of generated documents go through the incremental
// healer and the real compiler (engine-wasm, HTML, the streaming target), and
// failing ones through the engine server's Layer 3 fixers (#20), as in the
// worker. Errors that the fixers leave must belong to an allowed class; each
// class is allowed until the issue next to it removes it, and an allowed class
// that no longer occurs must be dropped from the list. The prefix compile rate
// with Layer 3 (PLAN §1) is printed and must not fall below RATE_FLOOR; raise
// the floor as classes go. What Layer 3 leaves, Layer 4 (#21) must render:
// asked for the stable prefix, as the client does once its last good render is
// stale, every prefix publishes an artifact.
//
// COMPILE_ORACLE_SAMPLE=1 compiles every stream prefix; `pnpm report` runs the
// full measurement.

import { describe, expect, it } from "vitest";
import { knownBug } from "../../../packages/heal/__tests__/support/known-bugs";
import type { ErrorClass } from "../support/classify";
import {
  compilesComplete,
  corpusDocuments,
  eduDocuments,
  generatedDocuments,
  type OracleDocument,
} from "../support/documents";
import { newEngine } from "../support/engine";
import { runDocument } from "../support/run";
import { type ClassifiedPrefix, formatStats, stats } from "../support/stats";

/**
 * Error classes Layer 3 may leave, and what handles each. Shrink this; don't grow it.
 * Since #20 these are values nested so deep in calls that three cuts would be
 * needed, more than the two fix rounds per revision; the client keeps its last
 * good render meanwhile (§5.6, #21).
 */
const DEEP =
  "#20 leaves values that need three cuts (`#place(center, dx: 3` inside content inside a call); last-good render, then the stable prefix (#21)";
const ALLOWED: Partial<Record<ErrorClass, string>> = {
  "missing-argument": DEEP,
  "type-mismatch": DEEP,
  "invalid-value": DEEP,
  // `syntax` only for heal's KNOWN_HEAL_BUGS (checked below); heal's corpus test fails on any other.
  syntax: "KNOWN_HEAL_BUGS in packages/heal/__tests__/support/known-bugs.ts",
};

/**
 * The sampled corpus rate with Layer 3 (PLAN §1's target is 99%). #13 measured
 * 88.1% with heal alone; #20's fixers reach 99.9%.
 */
const RATE_FLOOR = 0.99;

const TARGET = "html";
const SAMPLE = Number(process.env.COMPILE_ORACLE_SAMPLE ?? 3);
const GENERATED = 40;

const engine = newEngine();
const corpus = corpusDocuments().filter((doc) => compilesComplete(engine, doc, TARGET));
const generated = generatedDocuments(engine, GENERATED, TARGET);
const edu = eduDocuments();

/** Every SAMPLE-th chunk, offset per document so different cuts get covered, and the last. */
const run = (doc: OracleDocument, offset: number): Promise<ClassifiedPrefix[]> =>
  runDocument(engine, doc, {
    target: TARGET,
    sample: (i) => (i + offset) % SAMPLE === 0 || i === doc.chunks.length - 1,
  });

/** Errors Layer 3 left that are outside the allowlist, described. Syntax errors pass only for known heal bugs. */
const unexpected = (doc: OracleDocument, prefixes: ClassifiedPrefix[]): string[] =>
  prefixes.flatMap((p) => {
    if (p.fixedIn != null) return [];
    const prefix = doc.source.slice(0, p.cut);
    const syntax = p.errors.filter((e) => e.cls === "syntax").map((e) => ({ message: e.message, start: 0, end: 0 }));
    const bad = p.errors.filter((e) => !(e.cls in ALLOWED) || (e.cls === "syntax" && !knownBug(prefix, syntax)));
    if (bad.length === 0) return [];
    return [
      `${doc.id} @${p.cut}: …${JSON.stringify(prefix.slice(-60))}\n${bad.map((e) => `${e.cls}: ${e.message}`).join("\n")}`,
    ];
  });

describe("compile oracle: healed prefixes compile", () => {
  const seen = new Set<ErrorClass>();
  const all: ClassifiedPrefix[] = [];

  it.each(corpus.map((doc, i) => [doc.id, doc, i] as const))("%s", async (_, doc, i) => {
    const prefixes = await run(doc, i);
    all.push(...prefixes);
    for (const p of prefixes) if (p.fixedIn == null) for (const e of p.errors) seen.add(e.cls);
    expect(unexpected(doc, prefixes).slice(0, 5).join("\n\n")).toBe("");
  });

  it("edu documents compile when complete", () => {
    for (const doc of edu) expect(compilesComplete(engine, doc, TARGET), doc.id).toBe(true);
  });

  it.each(edu.map((doc, i) => [doc.id, doc, i] as const))("%s", async (_, doc, i) => {
    const prefixes = await run(doc, i);
    for (const p of prefixes) if (p.fixedIn == null) for (const e of p.errors) seen.add(e.cls);
    expect(unexpected(doc, prefixes).slice(0, 5).join("\n\n")).toBe("");
    const s = stats(prefixes);
    expect(s.fixedRate, doc.id).toBeGreaterThanOrEqual(RATE_FLOOR);
  });

  it("generated documents", async () => {
    const prefixes: ClassifiedPrefix[] = [];
    for (const [i, doc] of generated.entries()) prefixes.push(...(await run(doc, i)));
    for (const p of prefixes) if (p.fixedIn == null) for (const e of p.errors) seen.add(e.cls);
    const s = stats(prefixes);
    process.stdout.write(`\n${formatStats(`generated, ${TARGET}, 1 in ${SAMPLE} stream prefixes`, s)}\n`);
    expect(s.renderedRate).toBe(1);
  });

  it("prefix compile rate", () => {
    const s = stats(all);
    process.stdout.write(`\n${formatStats(`corpus, ${TARGET}, 1 in ${SAMPLE} stream prefixes`, s)}\n`);
    expect(s.fixedRate).toBeGreaterThanOrEqual(RATE_FLOOR);
    expect(s.renderedRate).toBe(1);
  });

  it("every allowed class still occurs (else drop it from ALLOWED)", () => {
    // Known heal bugs are rare cuts that sampling may miss; heal's corpus test checks that they still reproduce.
    const stale = Object.keys(ALLOWED).filter((cls) => cls !== "syntax" && !seen.has(cls as ErrorClass));
    expect(stale).toEqual([]);
  });
});
