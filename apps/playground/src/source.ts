// Where the playground's stream comes from: a corpus entry, a pasted document, or a stream file.
import { parseStream, type StreamChunk, synthesizeStream } from "@typstream/corpus/stream";
import { loadCorpusStream } from "./corpus";
import type { Source } from "./hash";
import { looksLikeStream } from "./stream";

export interface Loaded {
  /** Which source and seed these chunks were made from. */
  key: string;
  chunks: StreamChunk[];
  recorded: boolean;
  label: string;
}

export const sourceKey = (source: Source, seed: number): string =>
  source.kind === "corpus"
    ? `corpus:${source.id}:${seed}`
    : source.kind === "doc"
      ? `doc:${seed}:${source.text}`
      : `stream:${source.jsonl}`;

export const loadSource = async (source: Source, seed: number): Promise<Loaded> => {
  const key = sourceKey(source, seed);
  if (source.kind === "corpus") {
    const { chunks, recorded } = await loadCorpusStream(source.id, seed);
    return { key, chunks, recorded, label: source.id };
  }
  if (source.kind === "doc") {
    return { key, chunks: synthesizeStream(source.text, { seed }), recorded: false, label: "pasted document" };
  }
  return { key, chunks: parseStream(source.jsonl), recorded: true, label: source.name ?? "pasted stream" };
};

/** A pasted or opened text becomes a stream source or a document source. */
export const sourceFromText = (text: string, name?: string): Source =>
  looksLikeStream(text) ? { kind: "stream", jsonl: text, ...(name ? { name } : {}) } : { kind: "doc", text };
