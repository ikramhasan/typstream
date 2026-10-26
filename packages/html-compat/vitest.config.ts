import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    // Every case runs native typst once or twice; the corpus documents are several pages.
    testTimeout: 60_000,
  },
});
