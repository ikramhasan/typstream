// Layer 4 (#21, PLAN §5.6): no corpus document ends without a render.
//
// - Final mode: every corpus document that doesn't run away is healed as a
//   finished document (heal's final mode: lint, no tail repair) and compiled
//   through the engine server with block isolation, as the client compiles it
//   after `finish()`. Each must publish an artifact; documents with errors show
//   them as error blocks, found in at most ⌈log₂ n⌉ checks per block. Runaway
//   loops and memory bombs (`expect: limit`) need the client's watchdog: the
//   engine's browser tests run them.
// - Streaming: documents with errors that stay (the corpus's `expect: error`
//   entries) are streamed, and each failing prefix is compiled with block
//   isolation, as the client does: settled blocks that fail become error
//   blocks, so the rest of the document keeps rendering.

import { loadCorpus, streamOf } from "@typstream/corpus";
import { heal } from "@typstream/heal";
import { describe, expect, it } from "vitest";
import { blockStarts } from "../../../packages/engine/src/server/anchors";
import { corpusFiles, type OracleDocument, setFiles } from "../support/documents";
import { newEngine } from "../support/engine";
import { compilePrefixes, type Target } from "../support/measure";
import { OracleServer } from "../support/server";

const TARGET: Target = "html";
const engine = newEngine();

/** Every corpus entry the engine can compile without the watchdog. */
const entries = loadCorpus().filter((e) => e.meta.expect !== "limit");

interface FinalRow {
  id: string;
  blocks: number;
  isolated: number;
  checks: number;
  compiles: number;
  ms: number;
}

describe("final mode: every corpus document renders", () => {
  const rows: FinalRow[] = [];

  it.each(entries.map((e) => [e.id, e] as const))("%s", async (_, entry) => {
    const doc: OracleDocument = {
      id: entry.id,
      source: entry.source,
      chunks: [],
      times: [],
      files: corpusFiles(entry),
    };
    setFiles(engine, doc);
    const source = heal(entry.source, { final: true }).source;
    const server = await OracleServer.open(engine);
    const t0 = performance.now();
    const out = await server.compile(source, source.length, TARGET, { mode: "final", fallback: { isolate: true } });
    const ms = performance.now() - t0;
    expect(out.result.status).toBe("ok");
    const isolated = out.result.fallback?.isolated ?? [];
    const blocks = blockStarts(source).length;
    rows.push({ id: entry.id, blocks, isolated: isolated.length, checks: out.checks, compiles: out.compiles, ms });
    expect(isolated.length > 0).toBe(entry.meta.expect === "error" || entry.id === "adversarial/deep-nesting-64");
    // Bisection: at most ⌈log₂ n⌉ checks per isolated block.
    expect(out.checks).toBeLessThanOrEqual(isolated.length * Math.ceil(Math.log2(Math.max(blocks, 2))));
  });

  it("summary", () => {
    const failing = rows.filter((r) => r.isolated > 0);
    process.stdout.write(
      [
        "",
        `### Final mode, ${TARGET}: ${rows.length} corpus documents render, ${failing.length} with error blocks`,
        "",
        "| Document | Blocks | Isolated | Checks | Compiles | ms |",
        "|---|---:|---:|---:|---:|---:|",
        ...failing.map(
          (r) => `| ${r.id} | ${r.blocks} | ${r.isolated} | ${r.checks} | ${r.compiles} | ${r.ms.toFixed(0)} |`,
        ),
        "",
      ].join("\n"),
    );
    expect(rows).toHaveLength(entries.length);
  });
});

/** Streamed documents with errors that stay, small enough to compile every prefix of. */
const erroneous = entries.filter((e) => e.meta.expect === "error" && e.source.length <= 20_000);

describe("streaming documents with errors", () => {
  it.each(erroneous.map((e) => [e.id, e] as const))("%s keeps rendering past its errors", async (_, entry) => {
    const doc: OracleDocument = {
      id: entry.id,
      source: entry.source,
      chunks: [],
      times: [],
      files: corpusFiles(entry),
    };
    setFiles(engine, doc);
    const plain = await OracleServer.open(engine);
    const isolating = await OracleServer.open(engine);
    const chunks = streamOf(entry).map((c) => c.text);
    let layer3 = 0;
    let layer4 = 0;
    let prefixes = 0;
    for (const p of compilePrefixes(engine, chunks, TARGET)) {
      prefixes++;
      if (p.errors.length === 0) {
        layer3++;
        layer4++;
        continue;
      }
      const fixed = await plain.compile(p.healed, p.stableOffset, TARGET);
      if (fixed.result.status === "ok") layer3++;
      const isolated = await isolating.compile(p.healed, p.stableOffset, TARGET, { fallback: { isolate: true } });
      if (isolated.result.status === "ok") layer4++;
    }
    const pct = (n: number) => `${((100 * n) / prefixes).toFixed(1)}%`;
    process.stdout.write(
      `\n${entry.id}: ${prefixes} stream prefixes render: ${pct(layer3)} with Layer 3, ${pct(layer4)} with block isolation\n`,
    );
    expect(layer4).toBeGreaterThanOrEqual(layer3);
  });
});
