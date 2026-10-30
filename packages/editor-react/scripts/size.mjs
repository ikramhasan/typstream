// Bundle size budgets (PLAN.md §11.6), minified + gzipped ESM, React and typstream's packages external:
// the editor's own code, and with Plate, Slate, Floating UI and the icons it uses, what an app loads
// for the editor (lazily, as Plate apps load theirs).
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const base = ["@typstream/*", "react", "react-dom", "react/jsx-runtime"];
const budgets = [
  { name: "own code", budget: 15.5 * 1024, external: [...base, "platejs", "platejs/*", "@platejs/*", "lucide-react"] },
  { name: "with Plate", budget: 210 * 1024, external: base },
];
let ok = true;
for (const { name, budget, external } of budgets) {
  const result = await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    platform: "browser",
    external,
    logLevel: "error",
  });
  const gz = gzipSync(result.outputFiles[0].contents, { level: 9 }).length;
  console.log(`@typstream/editor-react ${name}: ${kb(gz)} gzipped (budget ${kb(budget)})`);
  ok &&= gz <= budget;
}
process.exitCode = ok ? 0 : 1;
