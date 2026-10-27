import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadCorpus, streamOf } from "../../corpus/src/index.ts";

// Two projects. `node` (pnpm test): pure helpers. `browser` (pnpm
// test:browser): the renderers in Chromium, Firefox and WebKit, fed by the real
// engine worker as in @typstream/engine's browser tests.

const alias = {
  // Test against the source of sibling packages, not their builds.
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  "@typstream/engine": new URL("../engine/src/index.ts", import.meta.url).pathname,
  "@typstream/html-compat": new URL("../html-compat/src/index.ts", import.meta.url).pathname,
  "@typstream/edu": new URL("../edu/src/index.ts", import.meta.url).pathname,
  "@typstream/universe": new URL("../universe/src/index.ts", import.meta.url).pathname,
  "@typstream/google-fonts": new URL("../google-fonts/src/index.ts", import.meta.url).pathname,
  "@typstream/corpus": new URL("../../corpus/src/index.ts", import.meta.url).pathname,
};

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
          include: ["__tests__/browser/**/*.test.ts"],
          // One test file at a time per browser. html-render's streaming test and the paged tests each
          // run an engine worker; side by side on a 4-core CI runner (with the other two browsers going
          // too), 20-page final compiles in WebKit failed after ~12 s, which fits the 10 s final watchdog.
          fileParallelism: false,
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
                  // Documents read their set's assets/ as /assets/ (text files only so far).
                  const dir = join(dirname(e.path), "assets");
                  const names = existsSync(dir) ? readdirSync(dir) : [];
                  return {
                    name: e.name,
                    source: e.source,
                    chunks: streamOf(e).map((c) => c.text),
                    files: Object.fromEntries(names.map((n) => [`assets/${n}`, readFileSync(join(dir, n), "utf8")])),
                  };
                }),
            },
          },
        },
      },
    ],
  },
});
