// Bundle size budget (PLAN.md §11.6): @typstream/plate, minified + gzipped ESM. Its own code, Plate external, and with
// Plate (platejs, Slate), which an app pays for the editor. React, typstream and @typstream/* are external: an app with
// the editor has `<Typstream>` already.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
// 11.5 KB until #159's review fixes (code beside text it shows, props after mount: 0.3 KB) made it 11.6 KB.
const OWN = 12 * 1024;
// Plate's core (platejs: Slate, slate-react, its plugin system) is most of it: 156 KB.
const WITH_PLATE = 170 * 1024;

const size = async (external) => {
  const result = await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    platform: "browser",
    jsx: "automatic",
    external,
  });
  const code = result.outputFiles[0].contents;
  return { min: code.length, gz: gzipSync(code, { level: 9 }).length };
};

const base = ["react", "react-dom", "react/jsx-runtime", "typstream", "@typstream/*"];
const own = await size([...base, "platejs", "platejs/*", "slate-dom"]);
const all = await size(base);
console.log(`@typstream/plate: ${kb(own.min)} minified, ${kb(own.gz)} gzipped (budget ${kb(OWN)})`);
console.log(`@typstream/plate with Plate: ${kb(all.min)} minified, ${kb(all.gz)} gzipped (budget ${kb(WITH_PLATE)})`);
process.exitCode = own.gz <= OWN && all.gz <= WITH_PLATE ? 0 : 1;
