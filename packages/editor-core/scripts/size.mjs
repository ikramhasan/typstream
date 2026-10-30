// Bundle size budget (PLAN.md §11.6): minified + gzipped ESM, other typstream packages external.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const BUDGET_GZ = 7.5 * 1024;
const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  external: ["@typstream/*"],
});
const gz = gzipSync(result.outputFiles[0].contents, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`@typstream/editor-core: ${kb(gz)} gzipped (budget ${kb(BUDGET_GZ)})`);
process.exitCode = gz <= BUDGET_GZ ? 0 : 1;
