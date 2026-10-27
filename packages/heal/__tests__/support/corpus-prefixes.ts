// The every-prefix corpus suite, split across corpus-prefixes-<n>.test.ts (see prefixShard).

import { describe, expect, it } from "vitest";
import { createHealer } from "../../src";
import { corpusCases, describeFailure, knownBug, prefixShard, SMALL_DOC } from "./corpus";
import { syntaxErrors } from "./oracle";

export const PREFIX_SHARDS = 4;

export const prefixSuite = (shard: number): void => {
  const cases = corpusCases().filter((c) => c.healable && c.source.length <= SMALL_DOC);

  describe(`corpus: every prefix heals to valid syntax (${shard}/${PREFIX_SHARDS})`, () => {
    // One character at a time through the incremental healer (which equals
    // stateless healing, checked in corpus.test.ts), with Typst's parser on every output.
    it.each(prefixShard(cases, shard, PREFIX_SHARDS).map((c) => [c.id, c] as const))("%s", (_, c) => {
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
  });
};
