// The prelude acts only on the HTML target: paged output (every SVG page) is byte-identical
// with and without it, for every matrix entry and corpus document.
import { loadCorpus } from "@typstream/corpus";
import { describe, expect, it } from "vitest";
import { corpusFiles } from "./support/corpus";
import { compileSvg, newEngine } from "./support/engine";
import { MATRIX } from "./support/matrix";

const engine = newEngine();

const documents = [
  ...MATRIX.map((entry) => ({ name: `matrix: ${entry.name}`, source: entry.source, files: {} })),
  ...loadCorpus({ sets: ["edu"] }).map((entry) => ({
    name: entry.id,
    source: entry.source,
    files: corpusFiles(entry),
  })),
];

describe("paged output", () => {
  it.each(documents)("$name is unchanged by the prelude", ({ source, files }) => {
    const without = compileSvg(engine, source, { prelude: false, files });
    const withPrelude = compileSvg(engine, source, { files });
    expect(withPrelude.length).toBe(without.length);
    for (let i = 0; i < without.length; i++) expect(withPrelude[i] === without[i], `page ${i + 1}`).toBe(true);
  });
});
