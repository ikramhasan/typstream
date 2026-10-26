// engine-wasm for Node tests: the built wasm and base fonts from its dist/, as
// bytes (Node's fetch can't read files).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { engineWasm, type LazyFontInput } from "../../src/server/engine-wasm";

const dist = dirname(createRequire(import.meta.url).resolve("@typstream/engine-wasm"));
if (!existsSync(join(dist, "engine_bg.wasm"))) {
  throw new Error(`engine-wasm not built: run \`pnpm --filter @typstream/engine-wasm build\` (expected ${dist})`);
}

const wasm = readFileSync(join(dist, "engine_bg.wasm"));
const fonts = baseFonts.map((url) => new Uint8Array(readFileSync(url)));

/** The engine-wasm adapter with the base fonts, and `lazyFonts` registered to fetch when used. */
export const nodeEngineWasm = (lazyFonts: readonly LazyFontInput[] = []) => engineWasm({ wasm, fonts, lazyFonts });
