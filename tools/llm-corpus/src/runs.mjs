// Where recordings live: runs/<label>/<model>/<request>.{stream.jsonl,json}. Runs are working
// data (gitignored); the documents worth keeping are promoted into corpus/llm.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNS = fileURLToPath(new URL("../runs", import.meta.url));

export const runDir = (label, model) => join(RUNS, label, model);

/**
 * @typedef {{ label: string, model: string, request: string, chunks: { t: number, text: string }[],
 *   text: string, meta: Record<string, any>, plugins: string[], edits?: "quote" | "selection" }} Recording
 */

/** Every recording of a run, by model then request id. @returns {Recording[]} */
export const loadRun = (label) => {
  const dir = join(RUNS, label);
  if (!existsSync(dir)) throw new Error(`no run ${label} in ${RUNS}`);
  const { plugins, edits } = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  const out = [];
  for (const model of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(join(dir, model.name))
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const request = file.slice(0, -".json".length);
      const chunks = readFileSync(join(dir, model.name, `${request}.stream.jsonl`), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      out.push({
        label,
        model: model.name,
        request,
        chunks,
        text: chunks.map((c) => c.text).join(""),
        meta: JSON.parse(readFileSync(join(dir, model.name, file), "utf8")),
        plugins,
        edits,
      });
    }
  }
  return out;
};
