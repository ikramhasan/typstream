import { defineConfig } from "vitest/config";
import { conformanceProjects } from "../../tools/conformance/src/vitest.mjs";

// `node` (pnpm test): the generator's parts (fences, pele's SVG split into shapes and labels, the
// measurer), and documents through the engine's server with engine-wasm, the generator loaded by
// URL from its build as the worker loads it: both targets, every healed stream prefix of the
// examples, and Typst's keys against the generator's. The conformance suite (#135, pnpm test:paged
// and test:docx): the examples' pages against their PDF, and their DOCX export against the PDF.

const alias = {
  // Test against the source of sibling packages, not their builds; the engine-wasm build is loaded.
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  // Before the main entry, whose name is a prefix of it.
  "@typstream/engine/server": new URL("../engine/src/server.ts", import.meta.url).pathname,
  "@typstream/engine": new URL("../engine/src/index.ts", import.meta.url).pathname,
  "@typstream/docx": new URL("../docx/src/index.ts", import.meta.url).pathname,
  "@typstream/html-compat": new URL("../html-compat/src/index.ts", import.meta.url).pathname,
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "node", include: ["__tests__/*.test.ts"], testTimeout: 60_000 },
      },
      ...conformanceProjects(alias),
    ],
  },
});
