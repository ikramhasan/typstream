import { defineConfig } from "vitest/config";
import { conformanceProjects } from "../../tools/conformance/src/vitest.mjs";

// `node` (pnpm test): the vendored packages. The conformance suite (#135, pnpm test:paged and test:docx): a few
// documents using them, their pages against their PDF, and their DOCX export against the PDF.
const alias = { "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: "node", include: ["__tests__/*.test.ts"] } },
      ...conformanceProjects(alias),
    ],
  },
});
