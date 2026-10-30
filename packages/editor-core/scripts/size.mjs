// Bundle size budget (PLAN.md §11.6): @typstream/editor-core, minified + gzipped ESM. The engine,
// @typstream/dom's renderers and the parser (their own budgets) are external; @typstream/core's
// helpers are inlined. The editor loads when a teacher starts editing, not with the page view.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
// 23.0 KB when it was written (#36): the view, the commands, tables, marks and the basic plugins.
const BUDGET = 23.5 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  external: ["@typstream/engine", "@typstream/dom", "@typstream/syntax"],
  alias: { "@typstream/core": "../core/src/index.ts" },
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(`@typstream/editor-core: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(BUDGET)})`);
process.exitCode = gz <= BUDGET ? 0 : 1;
