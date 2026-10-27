// Bundle size budget (PLAN.md §11.6): minified + gzipped ESM, @typstream/core inlined.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

// 15 KB until #24's math-lone-script lint rule and currency-dollar fix (0.1 KB) and #65's closers for
// math groups in a call's arguments (0.07 KB) took it to 15.1 KB on main.
const BUDGET_GZ = 15.5 * 1024;
const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  alias: { "@typstream/core": "../core/src/index.ts" },
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`@typstream/heal: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(BUDGET_GZ)})`);
process.exitCode = gz <= BUDGET_GZ ? 0 : 1;
