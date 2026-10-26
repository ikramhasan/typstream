// The full #13 measurement: every stream prefix (or every code point, with
// COMPILE_ORACLE_STEP=char) of every oracle document, healed, compiled and
// classified, for each target. Prints a Markdown table per target and writes
// the classified prefixes as JSON. Run with `pnpm report`; it takes minutes.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { compilesComplete, corpusDocuments, generatedDocuments } from "../support/documents";
import { newEngine } from "../support/engine";
import type { Target } from "../support/measure";
import { runDocument } from "../support/run";
import { type ClassifiedPrefix, formatStats, stats } from "../support/stats";

const enabled = !!process.env.COMPILE_ORACLE_REPORT;
const step = process.env.COMPILE_ORACLE_STEP === "char" ? "char" : "stream";
const targets = (process.env.COMPILE_ORACLE_TARGETS ?? "html,paged").split(",") as Target[];
const generated = Number(process.env.COMPILE_ORACLE_GENERATED ?? 150);
const outFile = process.env.COMPILE_ORACLE_OUT ?? join(tmpdir(), `compile-oracle-${step}.json`);

it.runIf(enabled)("report", () => {
  const all: Record<string, ClassifiedPrefix[]> = {};
  const summaries: string[] = [];
  for (const target of targets) {
    const engine = newEngine();
    const corpus = corpusDocuments()
      .filter((doc) => compilesComplete(engine, doc, target))
      .flatMap((doc) => runDocument(engine, doc, { target, step, research: true }));
    const gen = generatedDocuments(engine, generated, target).flatMap((doc) =>
      runDocument(engine, doc, { target, step, research: true }),
    );
    engine.free();
    all[target] = [...corpus, ...gen];
    summaries.push(formatStats(`${target}, corpus (${step} prefixes)`, stats(corpus)));
    summaries.push(formatStats(`${target}, generated (${step} prefixes)`, stats(gen)));
  }
  writeFileSync(outFile, JSON.stringify(all));
  writeFileSync(outFile.replace(/\.json$/, ".md"), `${summaries.join("\n\n")}\n`);
  process.stdout.write(`${summaries.join("\n\n")}\n\nwrote ${outFile}\n`);
  expect(Object.keys(all)).toEqual(targets);
});
