// Copies a run's recordings into the corpus (corpus/llm): the model's text as the .typ, its
// stream as recorded, and a meta.json entry saying what native typst must do with it.
//
//   node src/promote.mjs <label> [--models a,b] [--only id,...]
//   pnpm corpus:validate llm/ --write-pages && pnpm fix     # then fill in the page counts
//
// Entries are named <label>-<model>-<request> (`kit-v2-sonnet-worksheet-decimals`). The text is
// kept exactly as the model wrote it, broken or not: a document that fails to compile becomes an
// `expect: "error"` entry naming its errors, the realistic failures the fixers and the LLM fix
// loop see. Expectations come from engine-wasm here and are checked natively by corpus:validate.
// Nothing personal is in them: the requests are the harness's own (requests.mjs).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compile, newEngine, preambleFor } from "./engine.mjs";
import { REQUESTS } from "./requests.mjs";
import { loadRun } from "./runs.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { models: { type: "string" }, only: { type: "string" } },
});
const [label] = positionals;
if (!label) {
  console.error("usage: promote.mjs <label> [--models a,b] [--only id,...]");
  process.exit(2);
}
const models = values.models?.split(",");
const only = values.only?.split(",");

const dir = fileURLToPath(new URL("../../../corpus/llm", import.meta.url));
const metaPath = join(dir, "meta.json");
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};

/** `claude-sonnet-5-5` → `sonnet`. */
const short = (model) => model.replace(/^claude-/, "").replace(/-\d.*$/, "");

/** A stable substring of an error for `expectedErrors`: the message up to the first name it quotes. */
const stable = (message) => message.split(/[`"(]/)[0].trim() || message;

const engine = newEngine();
for (const rec of loadRun(label)) {
  if (models && !models.includes(rec.model)) continue;
  if (only && !only.includes(rec.request)) continue;
  const request = REQUESTS.find((r) => r.id === rec.request);
  const name = `${label}-${short(rec.model)}-${rec.request}`;
  const preamble = preambleFor(rec.plugins);
  const diagnostics = compile(engine, rec.text, { preamble });
  const errors = [...new Set(diagnostics.filter((d) => d.severity === "error").map((d) => stable(d.message)))];
  const warnings = [...new Set(diagnostics.filter((d) => d.severity === "warning").map((d) => stable(d.message)))];
  writeFileSync(join(dir, `${name}.typ`), rec.text);
  writeFileSync(join(dir, `${name}.stream.jsonl`), rec.chunks.map((c) => `${JSON.stringify(c)}\n`).join(""));
  meta[name] = {
    category: request?.kind ?? "llm",
    ...(errors.length ? { expect: "error", expectedErrors: errors } : {}),
    ...(warnings.length ? { allowedWarnings: warnings } : {}),
    tags: ["llm", ...(request?.tags ?? [])],
    ...(rec.plugins.length ? { plugins: rec.plugins } : {}),
    stream: { source: "recorded", model: rec.model },
    prompt: { kit: label, request: request?.request ?? rec.request },
    ...(rec.meta.stopReason === "max_tokens" ? { notes: "Cut off at max_tokens." } : {}),
  };
  console.log(`${name}: ${errors.length ? `error (${errors.join("; ")})` : "ok"}`);
}
const sorted = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(metaPath, `${JSON.stringify(sorted, null, 2)}\n`);
