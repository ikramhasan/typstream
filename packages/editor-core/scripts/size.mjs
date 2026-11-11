// Bundle size budget (PLAN.md §11.6): @typstream/editor-core, minified + gzipped ESM. The engine,
// @typstream/dom's renderers and the parser (their own budgets) are external; @typstream/core's
// helpers are inlined. The editor loads when a teacher starts editing, not with the page view.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
// 23.5 KB when it was written (#36): the view, the commands, tables, marks, links and the basic plugins.
// 24 KB until a word processor's list keys (an empty item up a level, Tab on an empty item, Backspace at
// an item's start), the caret on an empty item and Ctrl+Enter out of a component: 0.4 KB.
// 31.5 KB until the third QA pass (2026-11-10), 10.8 KB: the clipboard's two sides, blocks split and
// joined as a word processor does, marks changed in place, components' lists and outlines, the font,
// clicks beside what draws no text.
// 42.4 KB until code arguments were opened by a click (written as content, kept when the pages
// show the click was on one) and a rubric's rows got their keys: 1.6 KB.
const BUDGET = 44 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  external: ["@typstream/engine", "@typstream/dom", "@typstream/syntax"],
  alias: { "@typstream/core": "../core/src/index.ts" },
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(`@typstream/editor-core: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(BUDGET)})`);
process.exitCode = gz <= BUDGET ? 0 : 1;
