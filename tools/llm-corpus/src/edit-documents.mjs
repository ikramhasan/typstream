// The documents edit requests are made of (corpus/llm), and where a request's targets are.
import { blockRange } from "@typstream/ai";
import { ALL_SETS, loadCorpus } from "@typstream/corpus";
import { blockStarts } from "@typstream/heal";

const documents = new Map(
  loadCorpus({ sets: ALL_SETS })
    .filter((e) => e.set === "llm")
    .map((e) => [e.name, e.source]),
);

/** The document a request edits. */
export const baseDocument = (request) => {
  const text = documents.get(request.document);
  if (text === undefined) throw new Error(`${request.id}: no corpus/llm document ${request.document}`);
  return text;
};

/** Where `anchor` is in `text`; it must occur once. */
const find = (request, text, anchor) => {
  const at = text.indexOf(anchor);
  if (at < 0 || text.indexOf(anchor, at + 1) >= 0) {
    throw new Error(`${request.id}: "${anchor}" must occur once in ${request.document}`);
  }
  return { from: at, to: at + anchor.length };
};

/** The blocks a selection edit of the request rewrites: the first target's. */
export const selectionOf = (request) => {
  const text = baseDocument(request);
  return blockRange(text, find(request, text, request.targets[0]));
};

/** The index of the top-level block each anchor is in. */
export const blocksOf = (request, anchors = []) => {
  const text = baseDocument(request);
  const starts = blockStarts(text);
  return new Set(anchors.map((anchor) => blockAt(starts, find(request, text, anchor).from)));
};

/** The index of the block `offset` is in. */
export const blockAt = (starts, offset) => {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= offset) i++;
  return i;
};
