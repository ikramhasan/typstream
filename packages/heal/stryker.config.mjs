// Mutation testing for @typstream/heal (PLAN.md §11.1): `pnpm mutate`.
//
// The property suite runs with few, seeded examples (HEAL_PROPERTY_RUNS and
// HEAL_PROPERTY_SEED in the `mutate` script): instrumented code runs ~10x slower,
// and every surviving mutant runs all the tests that cover it. The seed keeps
// results reproducible. Survivors, including the equivalent mutants, are triaged
// on issue #6.

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.ts" },
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/**/*.ts", "!src/index.ts"],
  coverageAnalysis: "perTest",
  concurrency: Number(process.env.STRYKER_CONCURRENCY) || undefined,
  // A mutant that sends the scanner into a loop must time out, not hang the run.
  timeoutMS: 10_000,
  thresholds: { high: 90, low: 80, break: 80 },
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  incremental: process.env.STRYKER_INCREMENTAL === "1",
  incrementalFile: "reports/mutation/stryker-incremental.json",
  tempDirName: ".stryker-tmp",
};
