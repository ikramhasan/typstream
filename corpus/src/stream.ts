// Stream files (`<name>.stream.jsonl`): one chunk per line, `{"t": ms, "text": "..."}`,
// where `t` is the arrival time in milliseconds since the first chunk. Joining the
// chunks' text gives exactly the entry's `.typ` source.

export interface StreamChunk {
  /** Arrival time in ms since the start of the stream. Non-decreasing. */
  t: number;
  text: string;
}

export const parseStream = (jsonl: string): StreamChunk[] =>
  jsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const chunk = JSON.parse(line) as Partial<StreamChunk>;
      if (typeof chunk.t !== "number" || typeof chunk.text !== "string") {
        throw new Error(`stream line ${i + 1}: expected {"t": number, "text": string}`);
      }
      return { t: chunk.t, text: chunk.text };
    });

export const formatStream = (chunks: readonly StreamChunk[]): string =>
  chunks.map((c) => `${JSON.stringify({ t: c.t, text: c.text })}\n`).join("");

export const joinStream = (chunks: readonly StreamChunk[]): string => chunks.map((c) => c.text).join("");

export interface SynthesizeOptions {
  /** PRNG seed; the same seed and source give the same stream. Default 1. */
  seed?: number;
  /** Mean generation speed. Default 60 tokens/s. */
  tokensPerSecond?: number;
  /** Providers batch tokens per event; each chunk carries 1..maxTokensPerChunk tokens. Default 3. */
  maxTokensPerChunk?: number;
}

// Rough BPE-shaped tokens: words up to 6 letters (longer ones split, like
// subwords), short digit runs, whitespace runs, and 1–2 symbol characters.
// Code points are never split, as providers deliver decoded text.
const TOKEN = /[ \t]*[\p{L}\p{M}]{1,6}|[\p{L}\p{M}]{1,6}|\p{N}{1,3}|\n+|[ \t]+|[^\p{L}\p{M}\p{N}\s]{1,2}|[\s\S]/gu;

export const tokenize = (source: string): string[] => source.match(TOKEN) ?? [];

/** mulberry32: small, fast, deterministic. */
const prng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Splits a source into a deterministic, token-sized synthetic stream with LLM-like timing. */
export const synthesizeStream = (source: string, options: SynthesizeOptions = {}): StreamChunk[] => {
  const { seed = 1, tokensPerSecond = 60, maxTokensPerChunk = 3 } = options;
  const random = prng(seed);
  const tokens = tokenize(source);
  const chunks: StreamChunk[] = [];
  let t = 0;
  for (let i = 0; i < tokens.length; ) {
    const n = 1 + Math.floor(random() * maxTokensPerChunk);
    chunks.push({ t: Math.round(t), text: tokens.slice(i, i + n).join("") });
    i += n;
    // Jitter around the mean, with an occasional stall (network, provider batching).
    const stall = random() < 0.02 ? 150 + random() * 400 : 0;
    t += (n * 1000 * (0.5 + random())) / tokensPerSecond + stall;
  }
  return chunks;
};

export interface ReplayOptions {
  /** Playback rate relative to the recorded timing; Infinity (default) replays without waiting. */
  speed?: number;
}

/** Feeds chunks to `onChunk` in order, optionally honouring their timing. Awaits async callbacks. */
export const replay = async (
  chunks: readonly StreamChunk[],
  onChunk: (chunk: StreamChunk, index: number) => void | Promise<void>,
  options: ReplayOptions = {},
): Promise<void> => {
  const { speed = Number.POSITIVE_INFINITY } = options;
  const start = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as StreamChunk;
    if (Number.isFinite(speed)) {
      const wait = chunk.t / speed - (Date.now() - start);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    await onChunk(chunk, i);
  }
};
