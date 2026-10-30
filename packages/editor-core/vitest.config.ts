import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: { include: ["__tests__/**/*.test.ts"], testTimeout: 60_000 },
  // Test against the sources of sibling packages, not their builds.
  resolve: {
    alias: {
      "@typstream/core": at("../core/src/index.ts"),
      "@typstream/syntax": at("../syntax/src/index.ts"),
      "@typstream/corpus": at("../../corpus/src/index.ts"),
      "@typstream/edu": at("../edu/src/index.ts"),
    },
  },
});
