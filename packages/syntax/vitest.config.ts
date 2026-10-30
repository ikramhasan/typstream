import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["__tests__/**/*.test.ts"] },
  // Test against the corpus's source, not its build.
  resolve: { alias: { "@typstream/corpus": fileURLToPath(new URL("../../corpus/src/index.ts", import.meta.url)) } },
});
