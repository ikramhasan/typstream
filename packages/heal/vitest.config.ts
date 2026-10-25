import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    // Long property runs (HEAL_PROPERTY_RUNS) take minutes per test.
    testTimeout: process.env.HEAL_PROPERTY_RUNS ? 3_600_000 : 120_000,
  },
  resolve: {
    // Test against the source of sibling packages, not their builds.
    alias: { "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname },
  },
});
