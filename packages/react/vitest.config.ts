import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadCorpus, streamOf } from "../../corpus/src/index.ts";

// Two projects. `node` (pnpm test): configuration merging and the shared
// engine's lifetime, with fakes. `browser` (pnpm test:browser): <Typstream>
// with React Testing Library in Chromium, Firefox and WebKit, compiling in the
// real engine worker as @typstream/dom's browser tests do.

const alias = {
  // Test against the source of sibling packages, not their builds.
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  "@typstream/engine": new URL("../engine/src/index.ts", import.meta.url).pathname,
  "@typstream/docx": new URL("../docx/src/index.ts", import.meta.url).pathname,
  "@typstream/dom": new URL("../dom/src/index.ts", import.meta.url).pathname,
  "@typstream/html-compat": new URL("../html-compat/src/index.ts", import.meta.url).pathname,
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
          include: ["__tests__/browser/**/*.test.tsx"],
          // One test file at a time per browser: each runs an engine worker (see @typstream/dom's config).
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // BROWSERS=chromium runs one.
            instances: (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").map((browser) => ({ browser })),
            screenshotFailures: false,
            // The corpus reads files, so recorded streams are loaded here and sent to the browser.
            commands: {
              recordedStream: () => {
                const entry = loadCorpus({ sets: ["edu"] }).find((e) => e.name === "quiz-mcq-geography");
                if (!entry) throw new Error("corpus entry quiz-mcq-geography is missing");
                return { chunks: streamOf(entry).map((c) => c.text) };
              },
            },
          },
        },
      },
    ],
  },
});
