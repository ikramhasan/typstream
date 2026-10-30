import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects. `node` (pnpm test): nothing yet needs more than the browser one. `browser`
// (pnpm test:browser): <TypstEditor> with React Testing Library in Chromium, Firefox and WebKit,
// its previews compiled by the real engine worker, as @typstream/react's browser tests do.

const at = (path: string): string => new URL(path, import.meta.url).pathname;
const alias = {
  // Test against the source of sibling packages, not their builds.
  "@typstream/core": at("../core/src/index.ts"),
  "@typstream/heal": at("../heal/src/index.ts"),
  "@typstream/engine": at("../engine/src/index.ts"),
  "@typstream/docx": at("../docx/src/index.ts"),
  "@typstream/dom": at("../dom/src/index.ts"),
  "@typstream/react": at("../react/src/index.ts"),
  "@typstream/syntax": at("../syntax/src/index.ts"),
  "@typstream/editor-core": at("../editor-core/src/index.ts"),
  "@typstream/edu": at("../edu/src/index.ts"),
  "@typstream/html-compat": at("../html-compat/src/index.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: "node", include: ["__tests__/*.test.ts"], passWithNoTests: true } },
      {
        resolve: { alias },
        test: {
          name: "browser",
          include: ["__tests__/browser/**/*.test.tsx"],
          // One test file at a time per browser: each runs an engine worker.
          fileParallelism: false,
          testTimeout: 60_000,
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
