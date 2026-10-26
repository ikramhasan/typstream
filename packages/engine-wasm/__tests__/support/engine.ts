// Loads the built engine (dist/) into this test file's module graph. comemo's
// cache and the wasm memory are global per instance, and vitest gives every
// test file a fresh module graph, so each file gets its own instance.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fonts } from "./fonts.js";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
if (!existsSync(`${dist}engine.js`)) {
  throw new Error(`engine not built: run \`pnpm --filter @typstream/engine-wasm build\` (expected ${dist}engine.js)`);
}

const glue: typeof import("../../dist/engine.js") = await import("../../dist/engine.js");
glue.initSync({ module: readFileSync(`${dist}engine_bg.wasm`) });

export const { Engine } = glue;
export type { Diagnostic, HtmlResult, Range, SvgChangedResult } from "../../dist/engine.js";

/**
 * An engine with Typst's bundled fonts, the same ones native `typst` uses in
 * `native.ts`. Fonts belong to the instance, so they're added once per file.
 */
export const newEngine = (): InstanceType<typeof Engine> => {
  for (const font of fonts()) Engine.add_font(font.bytes);
  return new Engine();
};
