// Writes a synthetic `<name>.stream.jsonl` next to a corpus `.typ` and records
// its provenance in meta.json. Run `pnpm build` in corpus/ first.
//
//   pnpm --filter @typstream/corpus stream edu/worksheet-fractions.typ [--seed 7] [--tps 60] [--max-tokens 3]
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { formatStream, synthesizeStream } from "../dist/index.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : Number(args[i + 1]);
};
const file = args.find((a, i) => a.endsWith(".typ") && !args[i - 1]?.startsWith("--"));
if (!file) {
  console.error("usage: stream.mjs <set>/<name>.typ [--seed n] [--tps n] [--max-tokens n]");
  process.exit(2);
}

const path = resolve(file);
const name = basename(path, ".typ");
const options = Object.fromEntries(
  [
    ["seed", flag("--seed")],
    ["tokensPerSecond", flag("--tps")],
    ["maxTokensPerChunk", flag("--max-tokens")],
  ].filter(([, v]) => v !== undefined),
);
const chunks = synthesizeStream(readFileSync(path, "utf8"), options);
writeFileSync(join(dirname(path), `${name}.stream.jsonl`), formatStream(chunks));

const metaPath = join(dirname(path), "meta.json");
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
if (!meta[name]) throw new Error(`${name} is not in ${metaPath}`);
meta[name].stream = Object.keys(options).length > 0 ? { source: "synthetic", options } : { source: "synthetic" };
writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

const last = chunks.at(-1);
console.log(`${name}.stream.jsonl: ${chunks.length} chunks over ${((last?.t ?? 0) / 1000).toFixed(1)} s`);
