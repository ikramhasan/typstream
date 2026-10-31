import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects. `node` (pnpm test): the commands, against Typst's parser (@typstream/syntax) and,
// where layout matters, engine-wasm in-process. `browser` (pnpm test:browser): the editor on the
// real engine worker's pages in Chromium, Firefox and WebKit.

const alias = {
  // Test against the source of sibling packages, not their builds.
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  "@typstream/engine": new URL("../engine/src/index.ts", import.meta.url).pathname,
  "@typstream/dom": new URL("../dom/src/index.ts", import.meta.url).pathname,
  "@typstream/docx": new URL("../docx/src/index.ts", import.meta.url).pathname,
  "@typstream/syntax": new URL("../syntax/src/index.ts", import.meta.url).pathname,
  "@typstream/edu": new URL("../edu/src/index.ts", import.meta.url).pathname,
  "@typstream/mindmap": new URL("../mindmap/src/index.ts", import.meta.url).pathname,
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
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // BROWSERS=chromium runs one.
            instances: (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").map((browser) => ({ browser })),
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
