// The conformance suite's vitest projects (#135), for a plugin's vitest.config.ts: `paged`, its examples' pages against
// their PDF in a browser (Chromium unless BROWSERS says otherwise), and `docx`, their DOCX exports against the PDF in
// Node (LibreOffice and poppler on PATH). Each runs `__tests__/conformance/<name>.test.ts`; the plugin's other
// projects leave that folder out.
import { playwright } from "@vitest/browser-playwright";

/**
 * @param {Record<string, string>} alias the plugin's aliases (packages' sources), which the suite's own imports take too
 * @returns {import("vitest/config").TestProjectInlineConfiguration[]}
 */
export const conformanceProjects = (alias) => {
  // The suite's own imports of packages, from their sources too, but @typstream/node: it runs its build's workers. By
  // exact name: `@typstream/engine/server` is another entry.
  const root = new URL("../../../packages/", import.meta.url).pathname;
  // The suite itself: plugins don't depend on it (it imports the engine, which imports Universe's plugin for its
  // tests), so their tests find it by path.
  const suite = new URL("./", import.meta.url).pathname;
  const exact = {
    ...Object.fromEntries(
      ["core", "heal", "engine", "docx", "dom"].map((n) => [`@typstream/${n}`, `${root}${n}/src/index.ts`]),
    ),
    "@typstream/conformance/paged": `${suite}paged.ts`,
    "@typstream/conformance/docx": `${suite}docx.mjs`,
    "@typstream/conformance": `${suite}suite.ts`,
    ...alias,
  };
  const resolve = {
    alias: Object.entries(exact).map(([name, path]) => ({
      find: new RegExp(`^${name.replace(/[/.]/g, "\\$&")}$`),
      replacement: path,
    })),
  };
  return [
    {
      resolve,
      test: {
        name: "paged",
        include: ["__tests__/conformance/paged.test.ts"],
        // One file at a time per browser: each runs an engine worker (see @typstream/dom's config).
        fileParallelism: false,
        browser: {
          enabled: true,
          headless: true,
          provider: playwright(),
          instances: (process.env.BROWSERS ?? "chromium").split(",").map((browser) => ({ browser })),
          screenshotFailures: false,
        },
      },
    },
    {
      resolve,
      test: { name: "docx", include: ["__tests__/conformance/docx.test.ts"], testTimeout: 60_000 },
    },
  ];
};
