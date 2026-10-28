// Recorded answers to edit requests (#34): what a model wrote when asked to change a document of
// `llm/`, recorded by `tools/llm-corpus` (record-edits.mjs) and copied here by promote-edits.mjs.
// Layout: `corpus/edits/<name>.stream.jsonl` and one `edits.json` keyed by name. They aren't
// documents, so `loadCorpus()` doesn't load them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_ROOT } from "./load";
import { parseStream, type StreamChunk } from "./stream";

/** One recorded answer to an edit request. */
export interface EditAnswer {
  /** `<label>-<model>-<request>`, e.g. `edit-quote-v1-sonnet-capitals-harder`. */
  name: string;
  /** The `llm/` document the request edits. */
  document: string;
  /** What the teacher asked; for a selection edit, the instruction for the selection. */
  request: string;
  /** A selection edit's range in the document: the model wrote its new text only. */
  selection?: { from: number; to: number };
  /** The request doesn't say which part it means: asking is the right answer. */
  ask?: boolean;
  /** The model that answered. */
  model: string;
  /** The answer as it streamed. */
  stream: StreamChunk[];
}

/** Every recorded answer to an edit request, by name. */
export const loadEditAnswers = (root: string = CORPUS_ROOT): EditAnswer[] => {
  const dir = join(root, "edits");
  const manifest: Record<string, Omit<EditAnswer, "name" | "stream">> = JSON.parse(
    readFileSync(join(dir, "edits.json"), "utf8"),
  );
  return Object.entries(manifest).map(([name, entry]) => ({
    name,
    ...entry,
    stream: parseStream(readFileSync(join(dir, `${name}.stream.jsonl`), "utf8")),
  }));
};
