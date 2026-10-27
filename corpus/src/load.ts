// Loads corpus entries from disk (Node only). Layout: `corpus/<set>/<name>.typ`,
// an optional `<name>.stream.jsonl`, and one `<set>/meta.json` keyed by name.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStream, type StreamChunk, type SynthesizeOptions, synthesizeStream } from "./stream";

/** The corpus root (the directory holding the sets). */
export const CORPUS_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The sets `loadCorpus()` loads by default, in a stable order: plain Typst, no plugins. */
export const SETS = ["edu", "adversarial"] as const;
/**
 * Every set: the default ones, then `llm`, recorded model output (#24), and `islands`, documents
 * with render islands (#28: mind maps). Their documents are written in a plugin's vocabulary
 * (`meta.plugins`, e.g. edu's or the mind map's functions), so only callers that mount those
 * plugins load them.
 */
export const ALL_SETS = [...SETS, "llm", "islands"] as const;
export type CorpusSet = (typeof ALL_SETS)[number];

/**
 * What native `typst compile` (0.15.1, embedded fonts only) must do with the entry:
 * - `ok`: compiles; warnings all match `allowedWarnings`; page count equals `expectedPages`.
 * - `error`: fails, and every string in `expectedErrors` appears in the diagnostics.
 * - `limit`: must not succeed within the validator's time and memory limits
 *   (runaway loops, memory bombs, a stack overflow). The engine's watchdog, or
 *   its handling of a worker that traps, has to stop these.
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
  /**
   * Plugins the document is written for, by key: their files and preamble go on the document
   * before it compiles (`edu`: `@typstream/edu`'s files and its import). Default none.
   */
  plugins?: string[];
  /** For model output (the `llm` set): the prompt it was generated with and what was asked. */
  prompt?: { kit: string; request: string };
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
