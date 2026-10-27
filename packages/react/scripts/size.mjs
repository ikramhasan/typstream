// Bundle size budget (PLAN.md §11.6): @typstream/react with @typstream/dom's renderers,
// minified + gzipped ESM. React and @typstream/engine (with heal, its own budgets) are
// external; @typstream/core's helpers are inlined.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
// 15 KB until #19's renderer fixes (language and direction, filled areas in the dark theme, unchanged pages
// not redrawn, lone wrappers) added 0.3 KB to a bundle that was at 14.9; 15.5 KB until the paged text
// layer's structure, language and direction (#63) added 0.5 KB to 15.3; 16 KB until #29 applied Typst's inline
// styles through the CSSOM, for strict CSPs (0.15 KB), when it was 11 bytes under; 16.5 KB until #95's wide
// blocks (0.45 KB, most of it paid for by CSS strings without comments) left it 30 bytes over.
const BUDGET = 16.6 * 1024;

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
