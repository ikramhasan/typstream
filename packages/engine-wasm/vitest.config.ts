import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    // The memory tests compile 200 times; each test file gets its own wasm instance.
    testTimeout: 120_000,
  },
});
