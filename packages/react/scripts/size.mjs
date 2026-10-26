// Bundle size budget (PLAN.md §11.6): @typstream/react with @typstream/dom's renderers,
// minified + gzipped ESM. React and @typstream/engine (with heal, its own budgets) are
// external; @typstream/core's helpers are inlined.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const BUDGET = 15 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime", "@typstream/engine"],
  alias: { "@typstream/core": "../core/src/index.ts", "@typstream/dom": "../dom/src/index.ts" },
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(
  `@typstream/react (incl. @typstream/dom): ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(BUDGET)})`,
);
process.exitCode = gz <= BUDGET ? 0 : 1;
