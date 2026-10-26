// What the scrubber steps through: the loaded stream, optionally re-split finer.
import { type StreamChunk, tokenize } from "@typstream/corpus/stream";

/**
 * - `chunks`: as recorded (or synthesized), one provider event per step.
 * - `tokens`: each chunk cut into BPE-shaped tokens (corpus `tokenize`), sharing its arrival time.
 * - `chars`: one code point per step.
 */
export type Split = "chunks" | "tokens" | "chars";

export const SPLITS: readonly Split[] = ["chunks", "tokens", "chars"];

export const splitStream = (chunks: readonly StreamChunk[], split: Split): StreamChunk[] => {
  if (split === "chunks") return [...chunks];
  const cut = split === "tokens" ? tokenize : (text: string) => Array.from(text);
  return chunks.flatMap((c) => cut(c.text).map((text) => ({ t: c.t, text })));
};

/** `prefixes[i]` is the input after `i` steps: the UTF-16 length of the first `i` chunks joined. */
export const prefixLengths = (chunks: readonly StreamChunk[]): number[] => {
  const lengths = [0];
  let n = 0;
  for (const c of chunks) {
    n += c.text.length;
    lengths.push(n);
  }
  return lengths;
};

/** A `.stream.jsonl` pasted or opened as a file, as opposed to a plain document. */
export const looksLikeStream = (text: string): boolean => {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return false;
  return lines.every((line) => {
    try {
      const chunk = JSON.parse(line) as { t?: unknown; text?: unknown };
      return typeof chunk.t === "number" && typeof chunk.text === "string";
    } catch {
      return false;
    }
  });
};
