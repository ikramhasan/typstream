// Healing invariants (PLAN.md §5.4) over the shared corpus (corpus/, §11.2):
// real documents, written as models write them, instead of generated ones.
// Documents above SMALL_DOC are covered by corpus-large.test.ts.

import { existsSync } from "node:fs";
import { streamOf } from "@typstream/corpus";
import { describe, expect, it } from "vitest";
import { createHealer, heal } from "../src";
import { corpusCases, KNOWN_HEAL_BUGS, prefixShard, SMALL_DOC } from "./support/corpus";
import { PREFIX_SHARDS } from "./support/corpus-prefixes";
import { syntaxErrors } from "./support/oracle";

const cases = corpusCases().filter((c) => c.source.length <= SMALL_DOC);

describe("corpus: every prefix heals to valid syntax", () => {
  // The suite itself is split across corpus-prefixes-<n>.test.ts, one worker each.
  it("its shards cover every small healable document once, each with a test file", () => {
    const healable = cases.filter((c) => c.healable);
    const sharded = Array.from({ length: PREFIX_SHARDS }, (_, i) => prefixShard(healable, i + 1, PREFIX_SHARDS)).flat();
    const ids = (cs: readonly { id: string }[]) => cs.map((c) => c.id).sort();
    expect(ids(sharded)).toEqual(ids(healable));
    for (let n = 1; n <= PREFIX_SHARDS; n++) {
      expect(existsSync(new URL(`./corpus-prefixes-${n}.test.ts`, import.meta.url)), `shard ${n}`).toBe(true);
    }
  });

  it.each(KNOWN_HEAL_BUGS.map((b) => [b.name, b] as const))("known bug still reproduces: %s", (_, b) => {
    const out = heal(b.repro).source;
    const errors = syntaxErrors(out);
    expect(errors.length, `fixed? move "${b.name}" from KNOWN_HEAL_BUGS to constructs.test.ts`).toBeGreaterThan(0);
    expect(b.matches(b.repro, errors)).toBe(true);
  });
});

describe("corpus: complete documents", () => {
  // Real model output (corpus/llm, #24) has Markdown habits that parse, such as `**one**`: lint
  // fixes those and must change nothing else.
  it.each(cases.filter((c) => c.valid).map((c) => [c.id, c] as const))("%s comes back unchanged", (_, c) => {
    const final = heal(c.source, { final: true });
    const changes = final.findings.filter((f) => f.severity === "fix").flatMap((f) => f.changes);
    let expected = c.source;
    for (const ch of [...changes].sort((a, b) => b.from - a.from)) {
      expected = expected.slice(0, ch.from) + ch.insert + expected.slice(ch.to);
    }
    expect(final.source).toBe(expected);
    if (changes.length === 0) expect(heal(c.source).source).toBe(c.source);
  });
});

describe("corpus: replaying the stream", () => {
  // Token-sized chunks as a model sends them (recorded, or synthesized from
  // the source): incremental healing equals stateless healing along the way.
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const healer = createHealer();
    let text = "";
    const chunks = streamOf(c);
    chunks.forEach((chunk, i) => {
      text += chunk.text;
      const inc = healer.push(chunk.text).source;
      if (i % 8 === 0 || i === chunks.length - 1) expect(inc, `after chunk ${i}`).toBe(heal(text).source);
    });
    expect(text).toBe(c.source);
    expect(healer.finish().source).toBe(heal(text, { final: true }).source);
  });
});
