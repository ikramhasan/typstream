// Bundle size budgets (PLAN.md §11.6), minified + gzipped ESM, React and @typstream/core external:
// - the plugin (`.`): mostly the Typst package and the prompt kit, as strings;
// - the React entry (`./react`), what an app's bundle carries before any map shows;
// - the chunk it loads when a map first shows: the interactive map with React Flow and its CSS.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const external = ["react", "react-dom", "react/jsx-runtime", "@typstream/core"];

const gz = (bytes) => gzipSync(bytes, { level: 9 }).length;

const plugin = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  external,
});

const react = await build({
  entryPoints: ["src/react.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  splitting: true,
  outdir: "out",
  write: false,
  jsx: "automatic",
  external,
});
const entry = react.outputFiles.find((f) => f.path.endsWith("/react.js"));
const chunks = react.outputFiles.filter((f) => f !== entry);

const results = [
  ["plugin", gz(plugin.outputFiles[0].contents), 10 * 1024],
  ["React entry", gz(entry.contents), 1 * 1024],
  [
    "interactive map (React Flow, loaded with the first map)",
    chunks.reduce((n, f) => n + gz(f.contents), 0),
    66 * 1024,
  ],
];
let ok = true;
for (const [name, size, budget] of results) {
  console.log(`@typstream/mindmap ${name}: ${kb(size)} gzipped (budget ${kb(budget)})`);
  if (size > budget) ok = false;
}
process.exitCode = ok ? 0 : 1;
