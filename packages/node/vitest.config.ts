import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    // Workers load a 20 MB wasm engine and the watchdog tests wait for budgets to run out.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    // Test against the source of sibling packages, not their builds (engine-wasm has no source to alias).
    // Exact matches: an alias of a bare name also catches its subpaths.
    alias: [
      ["@typstream/core", "../core/src/index.ts"],
      ["@typstream/engine", "../engine/src/index.ts"],
      ["@typstream/engine/server", "../engine/src/server.ts"],
      ["@typstream/engine/websocket", "../engine/src/websocket.ts"],
      ["@typstream/heal", "../heal/src/index.ts"],
      ["@typstream/corpus", "../../corpus/src/index.ts"],
    ].map(([name, path]) => ({ find: new RegExp(`^${name}$`), replacement: new URL(path, import.meta.url).pathname })),
  },
});
