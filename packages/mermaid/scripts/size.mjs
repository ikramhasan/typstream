// Bundle size budgets (PLAN.md §11.6), minified + gzipped ESM:
// - the plugin (`.`), on the main thread: the Typst package and the prompt kit, as strings, @typstream/core external;
// - the generator module the worker imports when a document with the plugin opens: pele (most of it), the label
//   fonts' widths and the code that splits pele's SVG, as the build writes it.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const gz = (bytes) => gzipSync(bytes, { level: 9 }).length;

const plugin = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  external: ["@typstream/core"],
});

const results = [
  ["plugin", gz(plugin.outputFiles[0].contents), 6 * 1024],
  ["generator (worker, with pele)", gz(readFileSync("generator/mermaid.js")), 285 * 1024],
];
let ok = true;
for (const [name, size, budget] of results) {
  console.log(`@typstream/mermaid ${name}: ${kb(size)} gzipped (budget ${kb(budget)})`);
  if (size > budget) ok = false;
}
process.exitCode = ok ? 0 : 1;
