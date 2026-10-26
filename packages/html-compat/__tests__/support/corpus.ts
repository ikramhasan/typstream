// Corpus documents read files from their set's assets/ directory ("assets/refs.yml"), which
// is /assets/ next to /main.typ in the engine.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CorpusEntry } from "@typstream/corpus";

export const corpusFiles = (entry: CorpusEntry): Record<string, Uint8Array> => {
  const dir = join(dirname(entry.path), "assets");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).map((name) => [`/assets/${name}`, readFileSync(join(dir, name))]));
};
