import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadCorpus, streamOf } from "../../corpus/src/index.ts";

// Two projects, both in Chromium, Firefox and WebKit (BROWSERS=chromium runs one):
// - `suites` (pnpm test:browser): final-render equivalence, flicker and
//   accessibility over the corpus. They assert on DOM and artifacts, not pixels,
//   so they run on any machine.
// - `visual` (pnpm test:visual): screenshots against the baselines in
//   __screenshots__/. Pixels depend on the OS's fonts and rasterizer, so this
//   project only exists inside Playwright's Docker image (scripts/visual.mjs sets
//   TYPSTREAM_VISUAL), locally and in CI alike.

const visual = process.env.TYPSTREAM_VISUAL === "1";

const alias = {
  // Test against the source of the packages, not their builds.
  "@typstream/core": new URL("../../packages/core/src/index.ts", import.meta.url).pathname,
  "@typstream/heal": new URL("../../packages/heal/src/index.ts", import.meta.url).pathname,
  "@typstream/engine": new URL("../../packages/engine/src/index.ts", import.meta.url).pathname,
  "@typstream/docx": new URL("../../packages/docx/src/index.ts", import.meta.url).pathname,
  "@typstream/dom": new URL("../../packages/dom/src/index.ts", import.meta.url).pathname,
  "@typstream/html-compat": new URL("../../packages/html-compat/src/index.ts", import.meta.url).pathname,
};

/** Every corpus document, with its stream and assets, for the browser (the corpus reads files). */
const corpusEntries = () =>
  loadCorpus().map((e) => {
    // Documents read their set's assets/ as /assets/ (text files only so far).
    const dir = join(dirname(e.path), "assets");
    const names = existsSync(dir) ? readdirSync(dir) : [];
    return {
      id: e.id,
      set: e.set,
      name: e.name,
      expect: e.meta.expect ?? "ok",
      tags: e.meta.tags ?? [],
      source: e.source,
      chunks: streamOf(e).map((c) => c.text),
      files: Object.fromEntries(names.map((n) => [`assets/${n}`, readFileSync(join(dir, n), "utf8")])),
    };
  });

const instances = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").map((browser) => ({ browser }));

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      visual
        ? {
            resolve: { alias },
            test: {
              name: "visual",
              include: ["__tests__/visual.test.ts"],
              fileParallelism: false,
              browser: {
                enabled: true,
                headless: true,
                // The caret stops blinking; nothing else animates (word fade-in is off).
                provider: playwright({
                  contextOptions: { reducedMotion: "reduce", viewport: { width: 1280, height: 9000 } },
                }),
                instances,
                viewport: { width: 1280, height: 9000 },
                screenshotFailures: false,
                commands: { corpusEntries },
                expect: {
                  toMatchScreenshot: {
                    comparatorName: "pixelmatch",
                    // Rendering in one image is deterministic up to antialiasing at glyph edges, which pixelmatch
                    // ignores (and so are baselines quantized to 256 colours, scripts/visual.mjs). A threshold of 0.2
                    // let text go from #1c1c1e to #4a4a4e unnoticed.
                    comparatorOptions: { threshold: 0.1, allowedMismatchedPixelRatio: 0.002 },
                    resolveScreenshotPath: ({ root, testFileDirectory, arg, browserName, ext }) =>
                      join(root, testFileDirectory, "__screenshots__", browserName, `${arg}${ext}`),
                    resolveDiffPath: ({ root, attachmentsDir, arg, browserName, ext }) =>
                      join(root, attachmentsDir, "visual", browserName, `${arg}${ext}`),
                  },
                },
              },
            },
          }
        : {
            resolve: { alias },
            test: {
              name: "suites",
              include: ["__tests__/*.test.ts"],
              exclude: ["__tests__/visual.test.ts"],
              // One file at a time per browser: each runs an engine worker (see @typstream/dom's config).
              fileParallelism: false,
              browser: {
                enabled: true,
                headless: true,
                provider: playwright(),
                instances,
                screenshotFailures: false,
                commands: { corpusEntries },
              },
            },
          },
    ],
  },
});
