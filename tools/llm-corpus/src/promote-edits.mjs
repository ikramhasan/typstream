// Copies a run's recorded answers to edit requests into the corpus (corpus/edits), for the
// edit session's tests to replay offline: each answer's stream as recorded, and in edits.json what
// it answers (the document, the request, and for a selection edit the range it rewrites).
//
//   node src/promote-edits.mjs <label>... [--models a,b] [--only id,...]
//
// Entries are named <label>-<model>-<request> (`edit-quote-v1-sonnet-capitals-harder`). Nothing
// personal is in them: the requests are the harness's own (edits.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { selectionOf } from "./edit-documents.mjs";
import { EDIT_REQUESTS } from "./edits.mjs";
import { loadRun } from "./runs.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { models: { type: "string" }, only: { type: "string" } },
});
if (!positionals.length) {
  console.error("usage: promote-edits.mjs <label>... [--models a,b] [--only id,...]");
  process.exit(2);
}
const models = values.models?.split(",");
const only = values.only?.split(",");

const dir = fileURLToPath(new URL("../../../corpus/edits/", import.meta.url));
const manifestPath = `${dir}edits.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const label of positionals) {
  for (const rec of loadRun(label)) {
    if (models && !models.includes(rec.model)) continue;
    if (only && !only.includes(rec.request)) continue;
    const request = EDIT_REQUESTS.find((r) => r.id === rec.request);
    const model = rec.model.replace(/^claude-/, "").replace(/-\d.*$/, "");
    const name = `${label}-${model}-${rec.request}`;
    writeFileSync(`${dir}${name}.stream.jsonl`, rec.chunks.map((c) => `${JSON.stringify(c)}\n`).join(""));
    manifest[name] = {
      document: request.document,
      request: rec.edits === "selection" ? request.instruction : request.request,
      ...(rec.edits === "selection" ? { selection: selectionOf(request) } : {}),
      ...(request.ask ? { ask: true } : {}),
      model: rec.model,
    };
    console.log(name);
  }
}
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
