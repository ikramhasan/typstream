// Bundle size budgets (PLAN.md §11.6), minified + gzipped ESM:
// - the main-thread part of the engine. @typstream/heal has its own budget and
//   is left out; @typstream/core's helpers are inlined.
// - the worker's JS: the server, core's helpers and engine-wasm's glue. The
//   wasm and the fonts are separate files with their own budgets.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const measure = async (label, entry, budget, external) => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    platform: "neutral",
    external,
    alias: { "@typstream/core": "../core/src/index.ts" },
  });
  const code = result.outputFiles[0].contents;
  const gz = gzipSync(code, { level: 9 }).length;
  console.log(`${label}: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(budget)})`);
  return gz <= budget;
};

// 8 KB until plugins (#27) moved their facet merging here from @typstream/dom and resolved them
// (dependencies, duplicates) once for every package: 0.7 KB, when #29's limits had left it at 7.5.
const MAIN_THREAD = 8.5 * 1024;

const ok = [
  await measure("@typstream/engine (main thread)", "src/index.ts", MAIN_THREAD, ["@typstream/heal"]),
  await measure("@typstream/engine (worker JS, excl. wasm and fonts)", "src/worker.ts", 40 * 1024, []),
];
process.exitCode = ok.every(Boolean) ? 0 : 1;
