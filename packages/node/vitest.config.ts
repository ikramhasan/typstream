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
    alias: {
      "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@typstream/engine/server": new URL("../engine/src/server.ts", import.meta.url).pathname,
      "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
      "@typstream/corpus": new URL("../../corpus/src/index.ts", import.meta.url).pathname,
    },
  },
});
