// `pnpm coverage`: line and branch coverage of the TypeScript packages (v8, through vitest), and the badges
// the README shows. The Coverage workflow (.github/workflows/coverage.yml) runs it after every push to main.
//
//   node tools/repo/coverage.mjs run node      each package's Node tests
//   node tools/repo/coverage.mjs run browser   their browser projects, in Chromium (v8 coverage only works there);
//                                              CI runs this inside Playwright's image (tools/repo/playwright-docker.mjs)
//   node tools/repo/coverage.mjs report        coverage/<package>/coverage-summary.json, coverage/summary.md, and
//                                              coverage/badges/*.json (shields.io endpoint badges)
//   node tools/repo/coverage.mjs [<package>…]  all three, for those packages (all of them by default)
//
// A run writes vitest blob reports (coverage/blobs/<package>/<project>.json) and `report` merges each package's with
// `vitest --merge-reports`, so its Node and browser tests count together though they ran in different places (mindmap's
// Node tests need native typst, which Playwright's image doesn't have). Packages run one at a time: engine's and node's
// tests have time budgets that fail when suites compete for the CPU.
//
// Measured: src/ of the packages below, generated assets left out. Not measured: edu, html-compat, universe and
// google-fonts, whose code is Typst or data (a few lines of TypeScript export it; their tests compile it with
// engine-wasm and native typst), typstream (re-exports), and engine-wasm (Rust, checked against native typst).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const out = join(root, "coverage");

/** Measured packages, and the vitest arguments of each environment they test in. */
const PACKAGES = [
  { name: "core", node: [] },
  { name: "heal", node: [] },
  { name: "engine", node: ["--project", "node"], browser: ["--project", "browser"] },
  { name: "dom", node: ["--project", "node"], browser: ["--project", "browser"] },
  { name: "react", node: ["--project", "node"], browser: ["--project", "browser"] },
  { name: "mindmap", node: ["--project", "node"], browser: ["--project", "browser"] },
  { name: "ai", node: [] },
  { name: "node", node: [] },
];

const COVERAGE = [
  "--coverage.enabled",
  "--coverage.provider=v8",
  "--coverage.include=src/**",
  "--coverage.exclude=src/**/*.generated.ts",
];

// The browser projects list Chromium, Firefox and WebKit unless BROWSERS narrows them, and coverage-v8 refuses a
// config with any but Chromium, merges included.
const env = { ...process.env, BROWSERS: "chromium" };

const vitest = (pkg, args) =>
  spawnSync("pnpm", ["exec", "vitest", ...args], { cwd: join(root, "packages", pkg), env, stdio: "inherit" }).status;

/** Runs each package's tests in `environment` ("node" or "browser"); returns the packages that failed. */
function run(environment, packages) {
  const failed = [];
  for (const p of packages) {
    if (!p[environment]) continue;
    const blob = join(out, "blobs", p.name, `${environment}.json`);
    rmSync(blob, { force: true });
    console.log(`\ncoverage: ${p.name} (${environment})`);
    // The blob holds the coverage; the run itself only prints a summary (vitest's default writes HTML into the package).
    const status = vitest(p.name, [
      "run",
      ...p[environment],
      ...COVERAGE,
      "--coverage.reporter=text-summary",
      `--coverage.reportsDirectory=${join(out, "runs", p.name, environment)}`,
      "--reporter=blob",
      `--outputFile=${blob}`,
    ]);
    if (status !== 0) failed.push(`${p.name} (${environment})`);
  }
  return failed;
}

const COLORS = [
  [95, "brightgreen"],
  [90, "green"],
  [80, "yellowgreen"],
  [70, "yellow"],
  [60, "orange"],
  [0, "red"],
];

const pct = ({ covered, total }) => (total === 0 ? 100 : (100 * covered) / total);

/** A shields.io endpoint badge (https://shields.io/badges/endpoint-badge). */
const badge = (label, metric) => {
  const p = pct(metric);
  const color = COLORS.find(([min]) => p >= min)[1];
  return `${JSON.stringify({ schemaVersion: 1, label, message: `${p.toFixed(1)}%`, color })}\n`;
};

/** Merges each package's blobs, then writes the summaries and badges; returns the packages that failed. */
function report(packages) {
  const failed = [];
  const rows = [];
  const total = { lines: { covered: 0, total: 0 }, branches: { covered: 0, total: 0 } };
  const badges = join(out, "badges");
  rmSync(badges, { recursive: true, force: true });
  mkdirSync(badges, { recursive: true });
  for (const p of packages) {
    const blobs = join(out, "blobs", p.name);
    const dir = join(out, p.name);
    const runs = existsSync(blobs) ? readdirSync(blobs).map((f) => f.replace(/\.json$/, "")) : [];
    if (runs.length === 0) {
      failed.push(`${p.name} (no test runs in coverage/blobs)`);
      continue;
    }
    console.log(`\ncoverage: ${p.name} (merging ${runs.join(", ")})`);
    rmSync(dir, { recursive: true, force: true });
    const status = vitest(p.name, [
      `--merge-reports=${blobs}`,
      ...COVERAGE,
      "--coverage.reporter=json-summary",
      `--coverage.reportsDirectory=${dir}`,
    ]);
    const summary = join(dir, "coverage-summary.json");
    if (status !== 0 || !existsSync(summary)) {
      failed.push(`${p.name} (merge)`);
      continue;
    }
    const t = JSON.parse(readFileSync(summary, "utf8")).total;
    for (const k of ["lines", "branches"]) {
      total[k].covered += t[k].covered;
      total[k].total += t[k].total;
      writeFileSync(join(badges, `${p.name}.${k}.json`), badge(k, t[k]));
    }
    rows.push([`@typstream/${p.name}`, t.lines, t.branches, runs]);
  }
  writeFileSync(join(badges, "total.json"), badge("coverage", total.lines));
  const cell = (m) => `${pct(m).toFixed(1)}% (${m.covered}/${m.total})`;
  const md = [
    "| Package | Lines | Branches | Tests |",
    "| --- | --- | --- | --- |",
    ...rows.map(([name, l, b, runs]) => `| ${name} | ${cell(l)} | ${cell(b)} | ${runs.join(", ")} |`),
    `| **Total** | ${cell(total.lines)} | ${cell(total.branches)} | |`,
  ].join("\n");
  writeFileSync(join(out, "summary.md"), `### Test coverage\n\n${md}\n`);
  console.log(`\n${md}`);
  return failed;
}

const [command, ...rest] = process.argv.slice(2);
const pick = (names) => {
  const unknown = names.filter((n) => !PACKAGES.some((p) => p.name === n));
  if (unknown.length > 0) {
    console.error(
      `coverage: not measured: ${unknown.join(", ")} (measured: ${PACKAGES.map((p) => p.name).join(", ")})`,
    );
    process.exit(2);
  }
  return names.length === 0 ? PACKAGES : PACKAGES.filter((p) => names.includes(p.name));
};

let failed;
if (command === "run" && (rest[0] === "node" || rest[0] === "browser")) failed = run(rest[0], pick(rest.slice(1)));
else if (command === "report") failed = report(pick(rest));
else if (command === "run") {
  console.error("usage: node tools/repo/coverage.mjs run node|browser [<package>…]");
  process.exit(2);
} else {
  const packages = pick(process.argv.slice(2));
  failed = [...run("node", packages), ...run("browser", packages), ...report(packages)];
}
if (failed.length > 0) {
  console.error(`\ncoverage: failed: ${failed.join(", ")}`);
  process.exit(1);
}
