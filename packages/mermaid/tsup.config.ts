import { packageConfig } from "../../tools/repo/tsup";

// index: the plugin (Typst files, preamble, prompt kit); tiny, for the main thread and servers.
// generator: the module the engine's worker imports by URL, so it bundles everything it uses
// (pele included) into one file outside dist/, at the same path from src/ and dist/
// (`new URL("../generator/mermaid.js", import.meta.url)`).
export default [
  packageConfig(),
  packageConfig({
    entry: { mermaid: "src/generator.ts" },
    outDir: "generator",
    noExternal: [/.*/],
    minify: true,
  }),
];
