import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["__tests__/**/*.test.ts"] },
  resolve: {
    // Test against the source of sibling packages, not their builds.
    alias: {
      "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
    },
  },
});
