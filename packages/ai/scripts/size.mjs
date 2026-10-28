// Bundle size budget (PLAN.md §11.6), minified + gzipped ESM. It reads AI SDK messages
// structurally, so nothing of the SDK is bundled. @typstream/heal and @typstream/core are
// external: every app that renders has them already (with their own budgets).
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
// 0.5 KB until streaming edits (#34: the parser, quote matching, the session, and the edit prompt's
// rules and feedback, about 1.5 KB of them text for the model) made it 4.3 KB.
const budget = 4.5 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  external: ["@typstream/core", "@typstream/heal"],
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(`@typstream/ai: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(budget)})`);
process.exitCode = gz <= budget ? 0 : 1;
