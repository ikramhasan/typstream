import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects. `node` (pnpm test): the menus' items. `browser` (pnpm test:browser): <TypstEditor>
// with React Testing Library in Chromium, Firefox and WebKit, compiling in the real engine worker as
// @typstream/react's browser tests do.

const alias = {
  // Test against the source of sibling packages, not their builds.
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  "@typstream/engine": new URL("../engine/src/index.ts", import.meta.url).pathname,
  "@typstream/docx": new URL("../docx/src/index.ts", import.meta.url).pathname,
  "@typstream/dom": new URL("../dom/src/index.ts", import.meta.url).pathname,
  "@typstream/react": new URL("../react/src/index.ts", import.meta.url).pathname,
  "@typstream/syntax": new URL("../syntax/src/index.ts", import.meta.url).pathname,
  "@typstream/editor-core": new URL("../editor-core/src/index.ts", import.meta.url).pathname,
  "@typstream/edu": new URL("../edu/src/index.ts", import.meta.url).pathname,
  "@typstream/mindmap": new URL("../mindmap/src/index.ts", import.meta.url).pathname,
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
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // BROWSERS=chromium runs one.
            instances: (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").map((browser) => ({ browser })),
            screenshotFailures: false,
            viewport: { width: 1200, height: 900 },
          },
        },
      },
    ],
  },
});
