// The documents whose prefixes must compile: the corpus documents that compile
// natively (plus the cut-off response, a prefix of one), and generated documents.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { type CorpusEntry, loadCorpus, streamOf, synthesizeStream } from "@typstream/corpus";
import { eduExamples, eduFiles, eduPreamble } from "@typstream/edu";
import { heal } from "@typstream/heal";
import { UNIVERSE_PACKAGES } from "@typstream/universe";
import fc from "fast-check";
import { untar } from "../../../packages/engine/src/server/tar";
// Heal's property-test generator: documents assembled from complete constructs.
import { documentArb } from "../../../packages/heal/__tests__/support/generators";
import type { Engine } from "./engine";
import { compileErrors, type Target } from "./measure";

export interface OracleDocument {
  id: string;
  source: string;
  /** Token-sized chunks as a model streams them. */
  chunks: string[];
  /** Arrival time of each chunk, in ms since the first. */
  times: number[];
  /** Files besides /main.typ, keyed by absolute path: sources as text, the rest as bytes. */
  files: Record<string, string | Uint8Array>;
}

/** Puts a document's files on the engine. */
export const setFiles = (engine: Engine, doc: OracleDocument): void => {
  for (const [path, content] of Object.entries(doc.files)) {
    if (typeof content === "string") engine.set_source(path, content);
    else engine.set_file(path, content);
  }
};

// Too slow to compile thousands of times (§11.2 "As built": seconds per native compile)
// or not a prefix of a compiling document.
const MAX_CORPUS_DOC = 20_000;
const MAX_PAGES = 50;

export const corpusFiles = (entry: CorpusEntry): Record<string, Uint8Array> => {
  // The only asset the corpus uses today; documents name it relative to themselves.
  const files: Record<string, Uint8Array> = {};
  for (const match of entry.source.matchAll(/bibliography\("([^"]+)"/g)) {
    const path = match[1] as string;
    files[`/${path}`] = readFileSync(join(dirname(entry.path), path));
  }
  return files;
};

export const corpusDocuments = (): OracleDocument[] =>
  loadCorpus()
    .filter(
      (e) =>
        ((e.meta.expect ?? "ok") === "ok" || e.meta.category === "truncated") &&
        e.source.length <= MAX_CORPUS_DOC &&
        (e.meta.expectedPages ?? 1) <= MAX_PAGES,
    )
    .map((e) => {
      const stream = streamOf(e);
      return {
        id: e.id,
        source: e.source,
        chunks: stream.map((c) => c.text),
        times: stream.map((c) => c.t),
        files: corpusFiles(e),
      };
    });

/**
 * @typstream/edu's prompt examples, written in its vocabulary (#23). The engine prepends edu's
 * import as a preamble, so it arrives whole: the first chunk carries it.
 */
export const eduDocuments = (): OracleDocument[] =>
  eduExamples.map((e) => {
    const stream = synthesizeStream(e.output);
    const chunks = stream.map((c) => c.text);
    chunks[0] = eduPreamble + (chunks[0] ?? "");
    return {
      id: `edu/${e.title}`,
      source: eduPreamble + e.output,
      chunks,
      times: stream.map((c) => c.t),
      files: eduFiles,
    };
  });

/** The vendored Universe packages' files under the `@ns/name:x.y.z/…` keys the engine roots them at. */
const universeFiles = (): Record<string, string | Uint8Array> => {
  const files: Record<string, string | Uint8Array> = {};
  for (const p of UNIVERSE_PACKAGES) {
    for (const [path, bytes] of untar(gunzipSync(readFileSync(fileURLToPath(p.url))))) {
      const key = `@${p.namespace}/${p.name}:${p.version}/${path}`;
      files[key] = path.endsWith(".typ") ? new TextDecoder().decode(bytes) : bytes;
    }
  }
  return files;
};

/**
 * Recorded model output in edu's vocabulary (corpus/llm, #24) that compiles when complete, with
 * the chunks exactly as the API streamed them. Edu's import is the preamble, arriving whole with
 * the first chunk; the vendored packages are mounted, as the app allows them.
 */
export const llmDocuments = (): OracleDocument[] => {
  const packages = universeFiles();
  return loadCorpus({ sets: ["llm"] })
    .filter((e) => (e.meta.expect ?? "ok") === "ok")
    .map((e) => {
      const stream = streamOf(e);
      const preamble = e.meta.plugins?.includes("edu") ? eduPreamble : "";
      const chunks = stream.map((c) => c.text);
      chunks[0] = preamble + (chunks[0] ?? "");
      return {
        id: e.id,
        source: preamble + e.source,
        chunks,
        times: stream.map((c) => c.t),
        files: { ...(preamble ? eduFiles : {}), ...packages },
      };
    });
};

/** A module for the generator's `#import "lib.typ": f`. */
const GENERATED_FILES = { "/lib.typ": "#let f(x) = x\n" };

/**
 * `count` generated documents (seeded) that compile as complete documents. Many
 * don't: the generator references `@ref-a`, which no atom defines, and repeats
 * labels. Those are dropped, since their prefixes can't be expected to compile.
 */
export const generatedDocuments = (engine: Engine, count: number, target: Target, seed = 13): OracleDocument[] => {
  const out: OracleDocument[] = [];
  engine.set_source("/lib.typ", GENERATED_FILES["/lib.typ"]);
  for (const source of fc.sample(documentArb, { seed, numRuns: count * 4 })) {
    if (out.length === count) break;
    if (compileErrors(engine, source, target).length > 0) continue;
    const stream = synthesizeStream(source);
    out.push({
      id: `generated/${out.length}`,
      source,
      chunks: stream.map((c) => c.text),
      times: stream.map((c) => c.t),
      files: GENERATED_FILES,
    });
  }
  return out;
};

/**
 * The complete document, healed, compiles for `target`: otherwise its prefixes
 * can't be expected to (64-deep nesting is too deep for HTML, for one).
 */
export const compilesComplete = (engine: Engine, doc: OracleDocument, target: Target): boolean => {
  setFiles(engine, doc);
  return compileErrors(engine, heal(doc.source).source, target).length === 0;
};
