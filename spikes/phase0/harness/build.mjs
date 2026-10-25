import { build } from "esbuild";
await build({
  entryPoints: { bench: "src/bench.mjs", "typstwasm.worker": "src/typstwasm.worker.mjs" },
  bundle: true,
  format: "esm",
  outdir: "dist",
  logLevel: "info",
  target: "es2022",
});
