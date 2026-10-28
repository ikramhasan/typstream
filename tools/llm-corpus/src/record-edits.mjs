// Records real model answers to edit requests (#34): the document and the request in, the
// answer's text deltas out, as record.mjs does for documents.
//
//   node src/record-edits.mjs --variant edit-quote --label edit-v1 [--models …] [--only id,...]
//
// `edit-selection` records the requests that have an `instruction`, the first target's blocks
// highlighted. Writes runs/<label>/system.md and run.json, and per model and request
// <id>.stream.jsonl and <id>.json. Requests already recorded are skipped. Needs
// ANTHROPIC_API_KEY, or ANTHROPIC_API_KEY_FILE naming a file that holds it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { editRequest, selectionRequest } from "@typstream/ai";
import { EDIT_REQUESTS } from "./edits.mjs";
import { baseDocument, selectionOf } from "./edit-documents.mjs";
import { RUNS, runDir } from "./runs.mjs";
import { recordStream } from "./stream.mjs";
import { EDIT_VARIANTS } from "./variants.mjs";

const { values } = parseArgs({
  options: {
    variant: { type: "string" },
    label: { type: "string" },
    models: { type: "string", default: "claude-haiku-5-5,claude-sonnet-5-5" },
    only: { type: "string" },
    concurrency: { type: "string", default: "4" },
  },
});
const variant = EDIT_VARIANTS[values.variant ?? ""];
if (!variant || !values.label) {
  console.error(`usage: record-edits.mjs --variant ${Object.keys(EDIT_VARIANTS).join("|")} --label <name>`);
  process.exit(2);
}
const { system, plugins, edits } = variant();
const label = values.label;
const models = values.models.split(",");
const only = values.only?.split(",");
const requests = EDIT_REQUESTS.filter(
  (r) => (!only || only.includes(r.id)) && (edits === "quote" || r.instruction !== undefined),
);

const apiKey = process.env.ANTHROPIC_API_KEY ?? readFileSync(process.env.ANTHROPIC_API_KEY_FILE ?? "", "utf8").trim();
const client = new Anthropic({ apiKey });

// A run's prompt is fixed once recorded: changed rules are a new label.
mkdirSync(join(RUNS, label), { recursive: true });
const systemPath = join(RUNS, label, "system.md");
if (existsSync(systemPath) && readFileSync(systemPath, "utf8") !== system) {
  console.error(`${systemPath} holds a different prompt: record the changed rules under a new label`);
  process.exit(2);
}
writeFileSync(systemPath, system);
writeFileSync(join(RUNS, label, "run.json"), `${JSON.stringify({ variant: values.variant, plugins, edits }, null, 2)}\n`);

/** The user turn of a request. */
const contentOf = (request) => {
  const document = baseDocument(request);
  if (edits === "quote") return editRequest(document, request.request);
  return selectionRequest(document, selectionOf(request), request.instruction);
};

const queue = models.flatMap((model) => requests.map((request) => ({ model, request })));
const workers = Array.from({ length: Number(values.concurrency) }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const base = join(runDir(label, job.model), job.request.id);
    if (existsSync(`${base}.json`)) continue;
    try {
      const meta = await recordStream(client, {
        model: job.model,
        system,
        content: contentOf(job.request),
        base,
        meta: { request: job.request.id },
      });
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
