import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadCorpus, streamOf, synthesizeStream } from "../../corpus/src/index.ts";

// Two projects. `node` (pnpm test): the client against a fake worker, and the
// server against engine-wasm on the calling thread. `browser` (pnpm
// test:browser): the real worker in Chromium, Firefox and WebKit.
//
// Worker code is tested in vitest's browser mode with the Playwright provider
// rather than with Node's worker_threads or a separate Playwright harness:
// it runs the actual `new Worker(new URL(…, import.meta.url))` bundling path,
// fetch and streaming wasm compilation in the three browsers we support, while
// keeping vitest's runner, assertions and reporters. Later browser suites
// (renderers, visual tests) add test files under `__tests__/browser/` or a
// project like this one.

const alias = {
  // Test against the source of sibling packages, not their builds.
  "@typstream/core": new URL("../core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../heal/src/index.ts", import.meta.url).pathname,
  "@typstream/corpus": new URL("../../corpus/src/index.ts", import.meta.url).pathname,
  "@typstream/universe": new URL("../universe/src/index.ts", import.meta.url).pathname,
  "@typstream/docx": new URL("../docx/src/index.ts", import.meta.url).pathname,
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
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // BROWSERS=chromium runs one.
            instances: (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").map((browser) => ({ browser })),
            screenshotFailures: false,
            // The corpus reads files, so streams are made here and sent to the browser.
            commands: {
              corpusStream: (_ctx, name: string) => {
                const entry = loadCorpus({ sets: ["edu"] }).find((e) => e.name === name);
                if (!entry) throw new Error(`no corpus entry edu/${name}`);
                return { source: entry.source, chunks: streamOf(entry).map((c) => c.text) };
              },
              synthesizeStream: (_ctx, source: string) => synthesizeStream(source).map((c) => c.text),
              adversarial: () =>
                loadCorpus({ sets: ["adversarial"] }).map((e) => ({
                  name: e.name,
                  source: e.source,
                  expect: e.meta.expect ?? "ok",
                })),
            },
          },
        },
      },
    ],
  },
});
