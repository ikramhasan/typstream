import type { Patch } from "@typstream/core";

/** A run of healed text; `added` marks what heal wrote rather than what the model did. */
export interface Segment {
  text: string;
  added?: boolean;
}

/**
 * The healed source from `from` on, split at the patches heal made there, so what it closed or
 * rewrote can be highlighted. Text heal cut has no result to show: it's listed in `dropped`.
 */
export function healedSegments(
  input: string,
  source: string,
  patches: readonly Patch[],
  from = 0,
): { segments: Segment[]; dropped: string[] } {
  const segments: Segment[] = [];
  const dropped: string[] = [];
  let at = from;
  for (const patch of [...patches].sort((a, b) => a.result.from - b.result.from)) {
    if (patch.result.to <= from && patch.result.from < from) continue;
    if (patch.result.from === patch.result.to) {
      const text = input.slice(patch.original.from, patch.original.to).trim();
      if (text) dropped.push(text);
      continue;
    }
    if (patch.result.from > at) segments.push({ text: source.slice(at, patch.result.from) });
    segments.push({ text: source.slice(Math.max(at, patch.result.from), patch.result.to), added: true });
    at = patch.result.to;
  }
  if (at < source.length) segments.push({ text: source.slice(at) });
  return { segments, dropped };
}
