// Healing invariants (PLAN.md §5.4) over the shared corpus (corpus/, §11.2):
// real documents, written as models write them, instead of generated ones.
// Documents above SMALL_DOC are covered by corpus-large.test.ts.

import { streamOf } from "@typstream/corpus";
import { describe, expect, it } from "vitest";
import { createHealer, heal } from "../src";
import { corpusCases, describeFailure, KNOWN_HEAL_BUGS, knownBug, SMALL_DOC } from "./support/corpus";
import { syntaxErrors } from "./support/oracle";

const cases = corpusCases().filter((c) => c.source.length <= SMALL_DOC);

describe("corpus: every prefix heals to valid syntax", () => {
  // One character at a time through the incremental healer (which equals
  // stateless healing, checked below), with Typst's parser on every output.
  it.each(cases.filter((c) => c.healable).map((c) => [c.id, c] as const))("%s", (_, c) => {
    const healer = createHealer();
    const unknown: string[] = [];
    // Index by UTF-16 unit: streams may split surrogate pairs.
    for (let i = 0; i <= c.source.length; i++) {
      const out = i === 0 ? healer.result().source : healer.push(c.source[i - 1] as string).source;
      const errors = syntaxErrors(out);
      const prefix = c.source.slice(0, i);
      if (errors.length > 0 && !knownBug(prefix, errors)) unknown.push(describeFailure(c.id, prefix, out, errors));
    }
    expect(unknown.slice(0, 5).join("\n\n")).toBe("");
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
