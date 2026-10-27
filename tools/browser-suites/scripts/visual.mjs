#!/usr/bin/env node
// Runs the visual project (vitest.config.ts) inside Playwright's Docker image, so
// screenshots come from the same fonts, rasterizer and browser builds on every
// machine: baselines made on a laptop hold on CI's runners and vice versa.
//
//   pnpm test:visual              compare with the baselines in __tests__/__screenshots__/
//   pnpm visual:update            rewrite the baselines that changed (and add missing ones)
//   BROWSERS=chromium pnpm ...    one browser; extra arguments go to vitest (a file filter, -t)
//
// The image is the one for the Playwright version installed here, so the
// browsers are the ones the tests' playwright package drives. tools/repo/playwright-docker.mjs
// runs it: the repository mounted at the same path, as the current user, so new
// baselines aren't owned by root. Needs Docker.
//
// New and updated baselines are then stored as 256-colour palette PNGs, a third
// of the size. The comparison still passes: the colours quantizing changes are
// antialiasing at glyph edges, which pixelmatch tells apart and ignores, within
// the threshold. Baselines already stored that way are left alone, so a
// baseline that still matches never changes in git.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightImage, runInPlaywright } from "../../repo/playwright-docker.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "../..");
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const update = args.includes("--update");
const rest = args.filter((a) => a !== "--update");

const vitest = ["node", resolve(repo, "node_modules/vitest/vitest.mjs"), "run", "--project", "visual"];
if (update) vitest.push("--update");
vitest.push(...rest);

console.log(`visual: ${playwrightImage(pkg)}${update ? " (updating baselines)" : ""}`);
const result = runInPlaywright(vitest, { cwd: pkg, env: { TYPSTREAM_VISUAL: "1" } });
if (result.error) {
  console.error("visual: the visual suite needs Docker.");
  process.exit(1);
}

/** PNG colour type 3: already a palette image. */
const isPalette = (png) => png[25] === 3;

const pngs = (dir) =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".png"))
    .map((e) => join(e.parentPath, e.name));

const baselines = join(pkg, "__tests__/__screenshots__");
const fresh = (existsSync(baselines) ? pngs(baselines) : []).filter((path) => !isPalette(readFileSync(path)));
if (fresh.length > 0) {
  const sharp = require("sharp");
  for (const path of fresh) {
    const png = await sharp(readFileSync(path))
      .png({ palette: true, colours: 256, dither: 0, effort: 10, compressionLevel: 9 })
      .toBuffer();
    writeFileSync(path, png);
  }
  console.log(`visual: stored ${fresh.length} new or updated baselines as palette PNGs`);
}
process.exit(result.status ?? 1);
