// Loads corpus entries from disk (Node only). Layout: `corpus/<set>/<name>.typ`,
// an optional `<name>.stream.jsonl`, and one `<set>/meta.json` keyed by name.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStream, type StreamChunk, type SynthesizeOptions, synthesizeStream } from "./stream";

/** The corpus root (the directory holding the sets). */
export const CORPUS_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Sets in the corpus, in a stable order. */
export const SETS = ["edu", "adversarial"] as const;
export type CorpusSet = (typeof SETS)[number];

/**
 * What native `typst compile` (0.15.1, embedded fonts only) must do with the entry:
 * - `ok`: compiles; warnings all match `allowedWarnings`; page count equals `expectedPages`.
 * - `error`: fails, and every string in `expectedErrors` appears in the diagnostics.
 * - `limit`: must not succeed within the validator's time and memory limits
 *   (runaway loops, memory bombs). The engine's watchdog has to stop these.
 */
export type Expectation = "ok" | "error" | "limit";

export interface EntryMeta {
  /** Document kind: worksheet, quiz, exam, lesson-plan, rubric, ... or the adversarial class. */
  category: string;
  /** Defaults to `ok`. */
  expect?: Expectation;
  expectedPages?: number;
  /** Substrings; each warning native typst prints must contain one of them. */
  allowedWarnings?: string[];
  /** Substrings that must appear in the diagnostics when `expect` is `error`. */
  expectedErrors?: string[];
  /** Free-form tags (math, table, multilingual, rtl, ...). */
  tags?: string[];
  /** Where the `.stream.jsonl` came from, when there is one. */
  stream?: { source: "synthetic"; options?: SynthesizeOptions } | { source: "recorded"; model?: string };
  notes?: string;
}

export interface CorpusEntry {
  /** `<set>/<name>`, unique across the corpus. */
  id: string;
  set: CorpusSet;
  name: string;
  path: string;
  source: string;
  meta: EntryMeta;
  /** The recorded or committed stream, if the entry has a `.stream.jsonl`. */
  recordedStream?: StreamChunk[];
}

export interface LoadOptions {
  sets?: readonly CorpusSet[];
  root?: string;
}

export const loadCorpus = (options: LoadOptions = {}): CorpusEntry[] => {
  const { sets = SETS, root = CORPUS_ROOT } = options;
  const entries: CorpusEntry[] = [];
  for (const set of sets) {
    const dir = join(root, set);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Record<string, EntryMeta>;
    const names = readdirSync(dir)
      .filter((f) => f.endsWith(".typ"))
      .map((f) => f.slice(0, -".typ".length))
      .sort();
    for (const name of names) {
      const entryMeta = meta[name];
      if (!entryMeta) throw new Error(`${set}/${name}.typ has no entry in ${set}/meta.json`);
      const path = join(dir, `${name}.typ`);
      const streamPath = join(dir, `${name}.stream.jsonl`);
      const entry: CorpusEntry = {
        id: `${set}/${name}`,
        set,
        name,
        path,
        source: readFileSync(path, "utf8"),
        meta: entryMeta,
      };
      if (existsSync(streamPath)) entry.recordedStream = parseStream(readFileSync(streamPath, "utf8"));
      entries.push(entry);
    }
    for (const name of Object.keys(meta)) {
      if (!names.includes(name)) throw new Error(`${set}/meta.json lists "${name}" but ${set}/${name}.typ is missing`);
    }
  }
  return entries;
};

/** The entry's recorded stream, or a synthetic one derived from its source. */
export const streamOf = (entry: CorpusEntry, options?: SynthesizeOptions): StreamChunk[] =>
  entry.recordedStream ?? synthesizeStream(entry.source, options);
