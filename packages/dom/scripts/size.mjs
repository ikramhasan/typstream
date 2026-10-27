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
  // 9 KB until plugins' stylesheets (#27, 24 bytes) came in after #29 and #63 had left 7 bytes; 9.5 KB until
  // font catalogues' web fonts (`registerLoadedFont`, 0.29 KB) took it to 9.78 KB; 9.8 KB until render islands
  // (#28: the marker's data read before sanitizing, one island per marker identity, their CSS; 0.8 KB).
  await measure("@typstream/dom (HTML renderer, incl. its CSS)", "src/html/index.ts", 10.7 * 1024),
  await measure("@typstream/dom (paged renderer)", "src/paged/index.ts", 4 * 1024),
  await measure("@typstream/dom (standalone HTML export)", "src/export/index.ts", 2 * 1024),
];
process.exitCode = ok.every(Boolean) ? 0 : 1;
