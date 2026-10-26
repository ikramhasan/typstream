// The corpus (corpus/<set>/<name>.typ, .stream.jsonl, meta.json), bundled by Vite.
// Documents and streams are lazy chunks: the adversarial set holds a 1 MB file.
import type { EntryMeta } from "@typstream/corpus";
import { parseStream, type StreamChunk, synthesizeStream } from "@typstream/corpus/stream";

const sources = import.meta.glob<string>("../../../corpus/*/*.typ", { query: "?raw", import: "default" });
const streams = import.meta.glob<string>("../../../corpus/*/*.stream.jsonl", { query: "?raw", import: "default" });
const metas = import.meta.glob<Record<string, EntryMeta>>("../../../corpus/*/meta.json", {
  eager: true,
  import: "default",
});

export interface CorpusItem {
  /** `<set>/<name>`, as in `@typstream/corpus`. */
  id: string;
  set: string;
  name: string;
  meta: EntryMeta | undefined;
  recorded: boolean;
}

/** `SETS` from `@typstream/corpus`, whose entry point is Node-only. */
const SET_ORDER: readonly string[] = ["edu", "adversarial"];
const setRank = (set: string): number => (SET_ORDER.includes(set) ? SET_ORDER.indexOf(set) : SET_ORDER.length);

const idOf = (path: string, ext: string): string => path.slice("../../../corpus/".length, -ext.length);

export const CORPUS: CorpusItem[] = Object.keys(sources)
  .map((path) => {
    const id = idOf(path, ".typ");
    const [set = "", name = ""] = id.split("/");
    return {
      id,
      set,
      name,
      meta: metas[`../../../corpus/${set}/meta.json`]?.[name],
      recorded: `../../../corpus/${id}.stream.jsonl` in streams,
    };
  })
  .sort((a, b) => setRank(a.set) - setRank(b.set) || a.id.localeCompare(b.id));

export interface LoadedStream {
  chunks: StreamChunk[];
  /** True when the chunks came from a `.stream.jsonl`, false when synthesized. */
  recorded: boolean;
}

/** The entry's committed stream, or one synthesized from its source (like `streamOf`). */
export const loadCorpusStream = async (id: string, seed: number): Promise<LoadedStream> => {
  const load = sources[`../../../corpus/${id}.typ`];
  if (!load) throw new Error(`no corpus entry ${id}`);
  const stream = streams[`../../../corpus/${id}.stream.jsonl`];
  if (stream) return { chunks: parseStream(await stream()), recorded: true };
  const item = CORPUS.find((c) => c.id === id);
  const options = item?.meta?.stream?.source === "synthetic" ? item.meta.stream.options : undefined;
  return { chunks: synthesizeStream(await load(), { ...options, seed }), recorded: false };
};
