import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The workspace root, found by walking up rather than by a fixed relative path:
// Stryker runs the tests from a sandbox copy nested inside packages/heal.
const findRoot = (dir: string): string => (existsSync(join(dir, "pnpm-workspace.yaml")) ? dir : findRoot(dirname(dir)));
const root = findRoot(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["__tests__/support/setup.ts"],
    // Long property runs (HEAL_PROPERTY_RUNS) take minutes per test.
    testTimeout: process.env.HEAL_PROPERTY_RUNS ? 3_600_000 : 120_000,
  },
  resolve: {
    // Test against the source of sibling packages, not their builds.
    alias: {
      "@typstream/core": join(root, "packages/core/src/index.ts"),
      "@typstream/corpus": join(root, "corpus/src/index.ts"),
    },
  },
});
