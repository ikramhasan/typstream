/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

// Cross-origin isolation: without it browsers coarsen performance.now() to 100 µs,
// too coarse for heal's per-token budgets (PLAN.md §1). The engine's wasm may want
// SharedArrayBuffer later too. Same-origin resources only: the engine worker, its
// wasm and fonts are all served from here.
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Workspace packages resolve to their source, like tsconfig.base.json's paths: no
// build step before `dev`, and edits to heal hot-reload into the playground. The
// engine's `new Worker(new URL("./worker.js", import.meta.url))` finds worker.ts
// next to its source the same way. engine-wasm is the exception: it is the Rust
// crate's build output (`dist/`), resolved through its package.json.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@typstream/corpus/stream", replacement: `${root}corpus/src/stream.ts` },
      { find: "@typstream/mindmap/react", replacement: `${root}packages/mindmap/src/react.tsx` },
      {
        find: /^@typstream\/(core|heal|engine|docx|html-compat|dom|react|universe|mindmap|edu|syntax|editor-core|editor-react)$/,
        replacement: `${root}packages/$1/src/index.ts`,
      },
    ],
  },
  // The corpus is loaded through import.meta.glob from outside the app.
  server: { headers, fs: { allow: [root] } },
  preview: { headers },
  // The engine worker is a module worker; its chunks must be ES modules too.
  worker: { format: "es" },
  // Corpus documents are lazy chunks; the adversarial ones are big on purpose.
  // Two pages: the stream inspector (index.html) and the visual editor (editor.html, #36).
  build: {
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      input: { main: `${root}apps/playground/index.html`, editor: `${root}apps/playground/editor.html` },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
