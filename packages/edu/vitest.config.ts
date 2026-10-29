import { defineConfig } from "vitest/config";
import { conformanceProjects } from "../../tools/conformance/src/vitest.mjs";

// Test against the source of sibling packages, not their builds; the engine is loaded from its build.
const alias = {
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  "@typstream/html-compat": new URL("../html-compat/src/index.ts", import.meta.url).pathname,
};

// `node` (pnpm test): edu through engine-wasm and native `typst`. The conformance suite (#135, pnpm test:paged and
// test:docx): every example, template and catalogue entry's pages against its PDF, and its DOCX export against the PDF.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: ["__tests__/*.test.ts"],
          // Each case compiles six times (two targets, answers hidden and shown, with and without html-compat).
          testTimeout: 60_000,
        },
      },
      ...conformanceProjects(alias),
    ],
  },
});
