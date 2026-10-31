// Bundle size budget (PLAN.md §11.6): @typstream/editor-react, minified + gzipped ESM, without
// @typstream/editor-core (its own budget) and what <Typstream> already loads (React, the engine, dom,
// @typstream/react). lucide-react's icons are inlined: only those the toolbar draws.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
// 15.9 KB when it was written (#36): the toolbars, menus, component bars and their CSS.
const BUDGET = 16.4 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  mainFields: ["module", "main"],
  jsx: "automatic",
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@typstream/engine",
    "@typstream/dom",
    "@typstream/react",
    "@typstream/editor-core",
    "@typstream/syntax",
  ],
  alias: { "@typstream/core": "../core/src/index.ts" },
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(`@typstream/editor-react: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(BUDGET)})`);
process.exitCode = gz <= BUDGET ? 0 : 1;
