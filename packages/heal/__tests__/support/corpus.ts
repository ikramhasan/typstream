// The shared corpus (corpus/, PLAN.md §11.2) as seen by heal's tests.
import { ALL_SETS, type CorpusEntry, loadCorpus } from "@typstream/corpus";
import type { OracleError } from "./oracle";
import { syntaxErrors } from "./oracle";

export { KNOWN_HEAL_BUGS, knownBug } from "./known-bugs";

/** Above this size, prefixes are sampled with stateless healing (the incremental healer is too slow, see below). */
export const SMALL_DOC = 20_000;

export interface CorpusCase extends CorpusEntry {
  /**
   * Every prefix must heal to valid syntax: the document parses, or it is a cut-off
   * response (a prefix of a valid document). Markdown habits and over-deep nesting
   * don't qualify: lint leaves the unsettled tail alone, and depth can't be healed.
   */
  healable: boolean;
  /** The complete source parses: healing must return it unchanged. */
  valid: boolean;
}

// Every set, the recorded model output (llm) too: healing is syntax, so a document written for a
// plugin's functions heals like any other.
export const corpusCases = (): CorpusCase[] =>
  loadCorpus({ sets: ALL_SETS }).map((e) => {
    const valid = syntaxErrors(e.source).length === 0;
    return { ...e, valid, healable: valid || e.meta.category === "truncated" };
  });

/** Readable context for a failing prefix. */
export const describeFailure = (id: string, prefix: string, output: string, errors: OracleError[]): string =>
  `${id} @${prefix.length}: …${JSON.stringify(prefix.slice(-60))}\n` +
  `healed tail: …${JSON.stringify(output.slice(-80))}\nerrors: ${JSON.stringify(errors)}`;

/**
 * Shard `shard` (1-based) of `shards` of the small healable documents, for the every-prefix
 * suite: one test file per shard lets vitest run them on separate workers. Each prefix costs a
 * parse of the whole prefix, so a document costs about its length squared; documents go to the
 * least loaded shard, longest first, so the shards finish together.
 */
export const prefixShard = (cases: readonly CorpusCase[], shard: number, shards: number): CorpusCase[] => {
  const load = new Array<number>(shards).fill(0);
  const out: CorpusCase[][] = Array.from({ length: shards }, () => []);
  for (const c of [...cases].sort((a, b) => b.source.length - a.source.length || a.id.localeCompare(b.id))) {
    const i = load.indexOf(Math.min(...load));
    load[i] = (load[i] as number) + c.source.length ** 2;
    out[i]?.push(c);
  }
  return out[shard - 1] ?? [];
};
