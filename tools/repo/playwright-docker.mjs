#!/usr/bin/env node
// Runs a command inside Playwright's Docker image, whose browsers and system libraries
// are already installed: no `playwright install --with-deps`, whose apt mirror has
// stalled CI's browser jobs for 10+ minutes. The visual suite runs here too
// (tools/browser-suites/scripts/visual.mjs), so its screenshots don't depend on the
// machine's fonts and rasterizer.
//
//   node tools/repo/playwright-docker.mjs <command> [args…]
//
// The command runs in the current directory, with the image for the Playwright version
// installed there. The repository is mounted at the same path, so node_modules' links
// resolve, and the container runs as the current user, so files it writes aren't owned
// by root. The host's pnpm binary is mounted on PATH (smoke tests spawn `pnpm exec`).
// BROWSERS and CI pass through. Needs Docker.

import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The image for the Playwright version `dir` resolves (the engine's, from a directory without one). */
export const playwrightImage = (dir) => {
  const version = (from) => createRequire(join(from, "noop.js"))("playwright/package.json").version;
  let v;
  try {
    v = version(dir);
  } catch {
    v = version(join(repo, "packages/engine"));
  }
  return `mcr.microsoft.com/playwright:v${v}-noble`;
};

/** The pnpm binary on PATH, links resolved, or null. */
const hostPnpm = () => {
  try {
    return realpathSync(execFileSync("sh", ["-c", "command -v pnpm"], { encoding: "utf8" }).trim());
  } catch {
    return null;
  }
};

/**
 * Runs `command` in Playwright's image, in `cwd`. `env` adds variables (BROWSERS and CI
 * always pass through). Returns spawnSync's result.
 */
export const runInPlaywright = (command, { cwd = process.cwd(), env = {} } = {}) => {
  const image = playwrightImage(cwd);
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const pnpm = hostPnpm();
  const vars = { BROWSERS: process.env.BROWSERS, CI: process.env.CI, ...env };
  const docker = [
    "run",
    "--rm",
    "--init",
    // Chromium uses /dev/shm for its renderers; Docker's 64 MB default isn't enough.
    "--ipc=host",
    "--user",
    `${uid}:${gid}`,
    "-e",
    "HOME=/tmp",
    ...Object.entries(vars).flatMap(([k, v]) => (v === undefined ? [] : ["-e", `${k}=${v}`])),
    "-v",
    `${repo}:${repo}`,
    ...(pnpm ? ["-v", `${pnpm}:/usr/local/bin/pnpm:ro`] : []),
    "-w",
    cwd,
    image,
    ...command,
  ];
  console.log(`playwright-docker: ${image}: ${command.join(" ")}`);
  const result = spawnSync("docker", docker, { stdio: "inherit" });
  if (result.error) console.error(`playwright-docker: couldn't run docker (${result.error.message}).`);
  return result;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const command = process.argv.slice(2);
  if (command.length === 0) {
    console.error("usage: node tools/repo/playwright-docker.mjs <command> [args…]");
    process.exit(2);
  }
  process.exit(runInPlaywright(command).status ?? 1);
}
