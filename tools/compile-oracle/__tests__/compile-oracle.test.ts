// Do healed prefixes compile? (#13, PLAN.md §5.5, §11.1.) Sampled stream
// prefixes of the corpus and of generated documents go through the incremental
// healer and the real compiler (engine-wasm, HTML, the streaming target).
// Errors must belong to an allowed class; each class is allowed until the issue
// next to it removes it, and an allowed class that no longer occurs must be
// dropped from the list. The prefix compile rate (PLAN §1) is printed and must
// not fall below RATE_FLOOR; raise the floor as classes go.
//
// COMPILE_ORACLE_SAMPLE=1 compiles every stream prefix; `pnpm report` runs the
// full measurement with the simulated fixers.

import { describe, expect, it } from "vitest";
import { knownBug } from "../../../packages/heal/__tests__/support/known-bugs";
import type { ErrorClass } from "../support/classify";
import { compilesComplete, corpusDocuments, generatedDocuments, type OracleDocument } from "../support/documents";
import { newEngine } from "../support/engine";
import { runDocument } from "../support/run";
import { type ClassifiedPrefix, formatStats, stats } from "../support/stats";

/** Allowed error classes, and what removes each. Shrink this; don't grow it. */
const ALLOWED: Partial<Record<ErrorClass, string>> = {
  "missing-argument": "#20: a call closed before its required arguments arrived; drop the call (needs signatures)",
  "type-mismatch": "#20: a value still being typed (`#v(1`); heal could drop it syntactically",
  "invalid-value": '#20: a string or array still being typed (`rgb("#e`); heal could drop it syntactically',
  "file-not-found": "#20: a path still being typed",
  "citation-before-bibliography": "#20: pending-reference placeholder until #bibliography arrives",
  "partial-ref": "#20: a reference name still being typed (`@fig-` of `@fig-cell`)",
  "unknown-variable": "#20: closure parameters before `=>` (`.map(((l, t)`), or a half-typed identifier",
  "invalid-operation": "#20: half-typed operands, often a settled function called with them (cut at the call site)",
  // `syntax` only for heal's KNOWN_HEAL_BUGS (checked below); heal's corpus test fails on any other.
  syntax: "KNOWN_HEAL_BUGS in packages/heal/__tests__/support/known-bugs.ts",
};

/** The sampled corpus rate when this test was written (#13: 88.1%). Raise it as classes are fixed. */
const RATE_FLOOR = 0.87;

const TARGET = "html";
const SAMPLE = Number(process.env.COMPILE_ORACLE_SAMPLE ?? 3);
const GENERATED = 40;

const engine = newEngine();
const corpus = corpusDocuments().filter((doc) => compilesComplete(engine, doc, TARGET));
const generated = generatedDocuments(engine, GENERATED, TARGET);

/** Every SAMPLE-th chunk, offset per document so different cuts get covered, and the last. */
const run = (doc: OracleDocument, offset: number): ClassifiedPrefix[] =>
  runDocument(engine, doc, {
    target: TARGET,
    sample: (i) => (i + offset) % SAMPLE === 0 || i === doc.chunks.length - 1,
  });

/** Errors outside the allowlist, described. Syntax errors pass only for known heal bugs. */
const unexpected = (doc: OracleDocument, prefixes: ClassifiedPrefix[]): string[] =>
  prefixes.flatMap((p) => {
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

  it.each(corpus.map((doc, i) => [doc.id, doc, i] as const))("%s", (_, doc, i) => {
    const prefixes = run(doc, i);
    all.push(...prefixes);
    for (const p of prefixes) for (const e of p.errors) seen.add(e.cls);
    expect(unexpected(doc, prefixes).slice(0, 5).join("\n\n")).toBe("");
  });

  it("generated documents", () => {
    const prefixes = generated.flatMap((doc, i) => run(doc, i));
    for (const p of prefixes) for (const e of p.errors) seen.add(e.cls);
    process.stdout.write(`\n${formatStats(`generated, ${TARGET}, 1 in ${SAMPLE} stream prefixes`, stats(prefixes))}\n`);
  });

  it("prefix compile rate", () => {
    const s = stats(all);
    process.stdout.write(`\n${formatStats(`corpus, ${TARGET}, 1 in ${SAMPLE} stream prefixes`, s)}\n`);
    expect(s.rate).toBeGreaterThanOrEqual(RATE_FLOOR);
  });

  it("every allowed class still occurs (else drop it from ALLOWED)", () => {
    // Known heal bugs are rare cuts that sampling may miss; heal's corpus test checks that they still reproduce.
    const stale = Object.keys(ALLOWED).filter((cls) => cls !== "syntax" && !seen.has(cls as ErrorClass));
    expect(stale).toEqual([]);
  });
});
