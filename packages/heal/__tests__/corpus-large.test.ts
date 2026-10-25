// The corpus's large documents (1 MB, a 2,000-row table, a 200 KB single line,
// 10k-deep nesting). Every prefix would take hours, and the incremental healer
// is currently far over budget on these (tens of ms per token: nothing settles
// inside one huge table or line), so prefixes are sampled and healed statelessly.
// HEAL_CORPUS_SAMPLES raises the sample count.

import { describe, expect, it } from "vitest";
import { heal } from "../src";
import { corpusCases, describeFailure, knownBug, SMALL_DOC } from "./support/corpus";
import { syntaxErrors } from "./support/oracle";

const SAMPLES = Number(process.env.HEAL_CORPUS_SAMPLES ?? 24);
const cases = corpusCases().filter((c) => c.source.length > SMALL_DOC);

/** Evenly spread cut points, nudged off round positions so they land mid-construct. */
const cuts = (length: number): number[] => {
  const out: number[] = [];
  for (let k = 1; k <= SAMPLES; k++) out.push(Math.min(length, Math.floor((k * length) / SAMPLES) - ((k * 7919) % 97)));
  return out;
};

describe("corpus (large): sampled prefixes heal to valid syntax", () => {
  it.each(cases.filter((c) => c.healable).map((c) => [c.id, c] as const))("%s", (_, c) => {
    const unknown: string[] = [];
    for (const at of cuts(c.source.length)) {
      const prefix = c.source.slice(0, at);
      const out = heal(prefix).source;
      const errors = syntaxErrors(out);
      if (errors.length > 0 && !knownBug(prefix, errors)) unknown.push(describeFailure(c.id, prefix, out, errors));
    }
    expect(unknown.slice(0, 5).join("\n\n")).toBe("");
  });

  it.each(cases.filter((c) => c.valid).map((c) => [c.id, c] as const))("%s comes back unchanged", (_, c) => {
    expect(heal(c.source).source).toBe(c.source);
  });

  it.each(cases.filter((c) => !c.healable).map((c) => [c.id, c] as const))("%s heals without throwing", (_, c) => {
    for (const at of cuts(c.source.length)) expect(() => heal(c.source.slice(0, at))).not.toThrow();
  });
});
