import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadCorpus } from "../../corpus/src/index.ts";

// Two projects. `node` (pnpm test): the commands' edits of the Typst. `browser` (pnpm test:browser): the editor on
// the real engine worker in Chromium, Firefox and WebKit, its pages against the HTML target's, and editing.

// Test against the source of sibling packages, not their builds; exact names, so `@typstream/engine/images` isn't
// taken for a file in `@typstream/engine`'s.
const sources: Record<string, string> = {
  "@typstream/core": "../core/src/index.ts",
  "@typstream/heal": "../heal/src/index.ts",
  "@typstream/engine": "../engine/src/index.ts",
  "@typstream/engine/images": "../engine/src/images.ts",
  "@typstream/docx": "../docx/src/index.ts",
  "@typstream/dom": "../dom/src/index.ts",
  "@typstream/react": "../react/src/index.ts",
  "@typstream/html-compat": "../html-compat/src/index.ts",
  "@typstream/edu": "../edu/src/index.ts",
  "@typstream/universe": "../universe/src/index.ts",
  typstream: "../typstream/src/index.tsx",
};
const alias = Object.entries(sources).map(([name, path]) => ({
  find: new RegExp(`^${name.replace(/[/]/g, "\\/")}$`),
  replacement: new URL(path, import.meta.url).pathname,
}));

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "node", include: ["__tests__/*.test.ts"] },
      },
      {
        resolve: { alias },
        test: {
          name: "browser",
          include: ["__tests__/browser/**/*.test.tsx"],
          // One test file at a time per browser: each runs an engine worker (see @typstream/dom's config).
          fileParallelism: false,
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // BROWSERS=chromium runs one.
            instances: (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").map((browser) => ({ browser })),
            screenshotFailures: false,
            // The corpus reads files, so documents are loaded here and sent to the browser.
            commands: {
              corpusEntries: () =>
                loadCorpus({ sets: ["edu"] }).map((e) => {
                  const dir = join(dirname(e.path), "assets");
                  const names = existsSync(dir) ? readdirSync(dir) : [];
                  return {
                    name: e.name,
                    source: e.source,
                    files: Object.fromEntries(names.map((n) => [`assets/${n}`, readFileSync(join(dir, n), "utf8")])),
                  };
                }),
              eduExamples: () =>
                readdirSync(new URL("../edu/examples", import.meta.url))
                  .filter((n) => n.endsWith(".typ"))
                  .map((n) => ({
                    name: n,
                    source: readFileSync(new URL(`../edu/examples/${n}`, import.meta.url), "utf8"),
                  })),
            },
          },
        },
      },
    ],
  },
});
