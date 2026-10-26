/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

// Cross-origin isolation: without it browsers coarsen performance.now() to 100 µs,
// too coarse for heal's per-token budgets (PLAN.md §1). The engine's wasm may want
// SharedArrayBuffer later too.
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Workspace packages resolve to their source, like tsconfig.base.json's paths: no
// build step before `dev`, and edits to heal hot-reload into the playground.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@typstream/corpus/stream", replacement: `${root}corpus/src/stream.ts` },
      { find: /^@typstream\/(core|heal)$/, replacement: `${root}packages/$1/src/index.ts` },
    ],
  },
  // The corpus is loaded through import.meta.glob from outside the app.
  server: { headers, fs: { allow: [root] } },
  preview: { headers },
  // Corpus documents are lazy chunks; the adversarial ones are big on purpose.
  build: { chunkSizeWarningLimit: 2048 },
  test: { include: ["src/**/*.test.ts"] },
});
