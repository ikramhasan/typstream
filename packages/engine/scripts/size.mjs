// Bundle size budget (PLAN.md §11.6): the main-thread part of the engine,
// minified + gzipped ESM. @typstream/heal has its own budget and is left out;
// @typstream/core's helpers are inlined.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const BUDGET_GZ = 8 * 1024;
const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  external: ["@typstream/heal"],
  alias: { "@typstream/core": "../core/src/index.ts" },
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(
  `@typstream/engine (main thread): ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(BUDGET_GZ)})`,
);
process.exitCode = gz <= BUDGET_GZ ? 0 : 1;
