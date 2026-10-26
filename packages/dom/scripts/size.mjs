// Bundle size (PLAN.md §11.6), minified + gzipped ESM, per renderer. @typstream/dom
// has no row in §11.6's table; it counts toward @typstream/react's 15 KB.
// @typstream/core's helpers are inlined.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const measure = async (label, contents, budget) => {
  const result = await build({
    stdin: { contents, resolveDir: "src", loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    platform: "neutral",
    alias: { "@typstream/core": "../core/src/index.ts" },
  });
  const code = result.outputFiles[0].contents;
  const gz = gzipSync(code, { level: 9 }).length;
  console.log(`${label}: ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(budget)})`);
  return gz <= budget;
};

const ok = [
  await measure(
    "@typstream/dom (HTML renderer, incl. its CSS)",
    'export { createHtmlRenderer, registerMathFont } from "./html";',
    9 * 1024,
  ),
];
process.exitCode = ok.every(Boolean) ? 0 : 1;
