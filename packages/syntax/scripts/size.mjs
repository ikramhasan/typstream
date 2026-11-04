// Size budget (PLAN.md §11.6): the parser's wasm, brotli-compressed as servers send it, and the JS
// (the API and wasm-bindgen's glue), minified and gzipped. Run after `pnpm build`.
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const WASM_BUDGET_BR = 80 * 1024;
const JS_BUDGET_GZ = 3 * 1024;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const wasm = brotliCompressSync(readFileSync(new URL("../dist/syntax_bg.wasm", import.meta.url)), {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;
const { build } = await import("esbuild");
const result = await build({
  entryPoints: [new URL("../dist/index.js", import.meta.url).pathname],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
});
const js = gzipSync(result.outputFiles[0].contents, { level: 9 }).length;
console.log(
  `@typstream/syntax: wasm ${kb(wasm)} brotli (budget ${kb(WASM_BUDGET_BR)}), JS ${kb(js)} gzipped (budget ${kb(JS_BUDGET_GZ)})`,
);
process.exitCode = wasm <= WASM_BUDGET_BR && js <= JS_BUDGET_GZ ? 0 : 1;
