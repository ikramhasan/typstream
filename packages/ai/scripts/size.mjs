// Bundle size budget (PLAN.md §11.6), minified + gzipped ESM. It reads AI SDK messages
// structurally, so nothing of the SDK is bundled.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
const budget = 0.5 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(`@typstream/ai: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(budget)})`);
process.exitCode = gz <= budget ? 0 : 1;
