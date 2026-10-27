// Records real model streams: one document per (model, request), with the text deltas exactly
// as the API sent them and their arrival times, the chunk boundaries production sees (PLAN §11.2).
//
//   node src/record.mjs --variant kit --label kit-v1 [--models claude-haiku-5-5,claude-sonnet-5-5] [--only id,...]
//
// Writes runs/<label>/system.md, and runs/<label>/<model>/<request>.stream.jsonl ({"t", "text"}
// per delta, t in ms since the first) plus <request>.json (stop reason, usage, timings). Requests
// already recorded are skipped, so an interrupted run resumes. Needs ANTHROPIC_API_KEY, or
// ANTHROPIC_API_KEY_FILE naming a file that holds it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { REQUESTS } from "./requests.mjs";
import { RUNS, runDir } from "./runs.mjs";
import { VARIANTS } from "./variants.mjs";

const { values } = parseArgs({
  options: {
    variant: { type: "string" },
    label: { type: "string" },
    models: { type: "string", default: "claude-haiku-5-5,claude-sonnet-5-5" },
    only: { type: "string" },
    concurrency: { type: "string", default: "4" },
  },
});
const variant = VARIANTS[values.variant ?? ""];
if (!variant || !values.label) {
  console.error(`usage: record.mjs --variant ${Object.keys(VARIANTS).join("|")} --label <name>`);
  process.exit(2);
}
const { system, plugins } = variant();
const label = values.label;
const models = values.models.split(",");
const only = values.only?.split(",");
const requests = REQUESTS.filter((r) => !only || only.includes(r.id));

const apiKey = process.env.ANTHROPIC_API_KEY ?? readFileSync(process.env.ANTHROPIC_API_KEY_FILE ?? "", "utf8").trim();
const client = new Anthropic({ apiKey });

// A run's prompt is fixed once recorded: a later kit is a new label.
mkdirSync(join(RUNS, label), { recursive: true });
const systemPath = join(RUNS, label, "system.md");
if (existsSync(systemPath) && readFileSync(systemPath, "utf8") !== system) {
  console.error(`${systemPath} holds a different prompt: record the changed kit under a new label`);
  process.exit(2);
}
writeFileSync(systemPath, system);
writeFileSync(join(RUNS, label, "run.json"), `${JSON.stringify({ variant: values.variant, plugins }, null, 2)}\n`);

/** Streams one document and writes its recording. */
const record = async (model, request) => {
  const dir = runDir(label, model);
  const base = join(dir, request.id);
  if (existsSync(`${base}.json`)) return null;
  mkdirSync(dir, { recursive: true });
  const started = performance.now();
  let first;
  const chunks = [];
  // Defaults otherwise (adaptive thinking, the model's default effort), as an app that doesn't
  // tune them gets. The system prompt is the same for every request of a run, so it caches.
  const stream = client.messages.stream({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: request.request }],
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
  const meta = {
    model,
    request: request.id,
    stopReason: message.stop_reason,
    usage: message.usage,
    firstTextMs: first === undefined ? null : Math.round(first - started),
    totalMs: Math.round(performance.now() - started),
    chunks: chunks.length,
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(`${base}.json`, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
};

const queue = models.flatMap((model) => requests.map((request) => ({ model, request })));
const workers = Array.from({ length: Number(values.concurrency) }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    try {
      const meta = await record(job.model, job.request);
      if (meta)
        console.log(
          `${label} ${job.model} ${job.request.id}: ${meta.stopReason}, ${meta.usage.output_tokens} out, ${meta.chunks} chunks`,
        );
    } catch (error) {
      console.error(`${label} ${job.model} ${job.request.id}: ${error.message}`);
      process.exitCode = 1;
    }
  }
});
await Promise.all(workers);
