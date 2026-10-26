import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against the source of sibling packages, not their builds; the engine is loaded from its build.
    alias: {
      "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
      "@typstream/html-compat": new URL("../html-compat/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
    // Each case compiles six times (two targets, answers hidden and shown, with and without html-compat).
    testTimeout: 60_000,
  },
});
