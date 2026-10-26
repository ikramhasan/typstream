import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    // Thousands of compiles per document; the report compiles every stream prefix.
    testTimeout: process.env.COMPILE_ORACLE_REPORT ? 3_600_000 : 300_000,
  },
  resolve: {
    // Test against the source of the TS packages; the engine is loaded from its build.
    alias: {
      "@typstream/core": new URL("../../packages/core/src/index.ts", import.meta.url).pathname,
      "@typstream/heal": new URL("../../packages/heal/src/index.ts", import.meta.url).pathname,
      "@typstream/edu": new URL("../../packages/edu/src/index.ts", import.meta.url).pathname,
      "@typstream/corpus": new URL("../../corpus/src/index.ts", import.meta.url).pathname,
    },
  },
});
