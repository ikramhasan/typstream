// engine-wasm for Node tests: the built wasm and base fonts from its dist/, as
// bytes (Node's fetch can't read files).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { engineWasm } from "../../src/server/engine-wasm";

const dist = dirname(createRequire(import.meta.url).resolve("@typstream/engine-wasm"));
if (!existsSync(join(dist, "engine_bg.wasm"))) {
  throw new Error(`engine-wasm not built: run \`pnpm --filter @typstream/engine-wasm build\` (expected ${dist})`);
}

const wasm = readFileSync(join(dist, "engine_bg.wasm"));
const fonts = readdirSync(join(dist, "fonts"))
  .filter((name) => /\.(otf|ttf)$/.test(name))
  .map((name) => new Uint8Array(readFileSync(join(dist, "fonts", name))));

/** The engine-wasm adapter with the base fonts. */
export const nodeEngineWasm = () => engineWasm({ wasm, fonts });
