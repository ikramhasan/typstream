// Bundle size budget (PLAN.md §11.6): @typstream/editor-react, minified + gzipped ESM, without
// @typstream/editor-core (its own budget) and what <Typstream> already loads (React, the engine, dom,
// @typstream/react). lucide-react's icons are inlined: only those the toolbar draws.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
// 15.9 KB when it was written (#36): the toolbars, menus, component bars and their CSS.
// 18.2 KB until the third QA pass (2026-11-10), 9.5 KB: the font picker, menus and toolbars by keys,
// the link field, forms that check what they are given, the equation's field, the bars' placement.
// 27.8 KB until list fields (a rubric's levels and points, its rows' cells following them) and forms
// that follow a component as it grows: 0.8 KB.
// 28.6 KB until a component's choices, yes/no and numbers went on its bar, a formula's field opened
// on a click or Enter, plugins' switches ("Show answers") joined the toolbar, and Escape in a form gives the
// keys back to the document in Firefox and WebKit (2026-11-11): 1.3 KB.
const BUDGET = 30.0 * 1024;

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
