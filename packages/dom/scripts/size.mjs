// Bundle size budgets (PLAN.md §11.6), minified + gzipped ESM, per renderer. @typstream/dom
// counts toward @typstream/react's 15 KB. @typstream/engine is only imported for types;
// @typstream/core's helpers are inlined.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const measure = async (label, entry, budget) => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    platform: "neutral",
    external: ["@typstream/engine"],
    alias: { "@typstream/core": "../core/src/index.ts" },
  });
  const code = result.outputFiles[0].contents;
  const gz = gzipSync(code, { level: 9 }).length;
  console.log(`${label}: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(budget)})`);
  return gz <= budget;
};

const ok = [
  await measure("@typstream/dom (HTML renderer, incl. its CSS)", "src/html/index.ts", 9 * 1024),
  await measure("@typstream/dom (paged renderer)", "src/paged/index.ts", 4 * 1024),
  await measure("@typstream/dom (standalone HTML export)", "src/export/index.ts", 2 * 1024),
];
process.exitCode = ok.every(Boolean) ? 0 : 1;
