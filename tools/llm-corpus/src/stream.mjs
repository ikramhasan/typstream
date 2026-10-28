// One streamed answer, recorded: the text deltas exactly as the API sent them, with their arrival
// times (the chunk boundaries production sees, PLAN §11.2), and what the answer cost.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Streams one answer and writes `<base>.stream.jsonl` ({"t", "text"} per delta, t in ms since the
 * first) and `<base>.json` (stop reason, usage, timings). Defaults otherwise (adaptive thinking, the
 * model's default effort), as an app that doesn't tune them gets. The system prompt is the same
 * for every request of a run, so it caches.
 */
export const recordStream = async (client, { model, system, content, base, meta = {} }) => {
  mkdirSync(dirname(base), { recursive: true });
  const started = performance.now();
  let first;
  const chunks = [];
  const stream = client.messages.stream({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const now = performance.now();
      first ??= now;
      chunks.push({ t: Math.round(now - first), text: event.delta.text });
    }
  }
  const message = await stream.finalMessage();
  writeFileSync(`${base}.stream.jsonl`, chunks.map((c) => `${JSON.stringify(c)}\n`).join(""));
  const recorded = {
    model,
    ...meta,
    stopReason: message.stop_reason,
    usage: message.usage,
    firstTextMs: first === undefined ? null : Math.round(first - started),
    totalMs: Math.round(performance.now() - started),
    chunks: chunks.length,
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(`${base}.json`, `${JSON.stringify(recorded, null, 2)}\n`);
  return recorded;
};
