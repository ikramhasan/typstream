import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects. `node` (pnpm test): the Typst package through engine-wasm and native `typst`
// (both targets, every stream prefix of the examples), the data's checks and the layout.
// `browser` (pnpm test:browser): the island in <Typstream> with the real engine worker, in
// Chromium, Firefox and WebKit.

const alias = {
  // Test against the source of sibling packages, not their builds; the engine-wasm build is loaded.
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  "@typstream/engine": new URL("../engine/src/index.ts", import.meta.url).pathname,
  "@typstream/dom": new URL("../dom/src/index.ts", import.meta.url).pathname,
  "@typstream/react": new URL("../react/src/index.ts", import.meta.url).pathname,
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "node", include: ["__tests__/*.test.ts"], testTimeout: 60_000 },
      },
      {
        resolve: { alias },
        test: {
          name: "browser",
          include: ["__tests__/browser/**/*.test.tsx"],
          testTimeout: 60_000,
          // One test file at a time per browser: each runs an engine worker (see @typstream/dom's config).
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
