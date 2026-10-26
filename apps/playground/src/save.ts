// "Save as corpus case": the files a new corpus entry needs (corpus/README.md).
import type { EntryMeta } from "@typstream/corpus";
import { formatStream, joinStream, type StreamChunk } from "@typstream/corpus/stream";

export interface CaseInput {
  name: string;
  category: string;
  chunks: readonly StreamChunk[];
  /** How the stream was made, for meta.json's `stream` field. */
  stream: EntryMeta["stream"];
  notes: string;
}

/** Corpus names are file names: lowercase, digits and dashes. */
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\.(typ|stream\.jsonl|jsonl)$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "case";

export interface CaseFiles {
  typ: string;
  jsonl: string;
  /** The `meta.json` entry, keyed by name, ready to paste into `corpus/<set>/meta.json`. */
  meta: string;
}

export const caseFiles = (input: CaseInput): CaseFiles => {
  const meta: EntryMeta = { category: input.category || "uncategorized" };
  if (input.stream) meta.stream = input.stream;
  if (input.notes) meta.notes = input.notes;
  return {
    typ: joinStream(input.chunks),
    jsonl: formatStream(input.chunks),
    meta: JSON.stringify({ [input.name]: meta }, null, 2),
  };
};

export const download = (filename: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Let the download start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
