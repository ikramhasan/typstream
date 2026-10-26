import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Tests Stryker runs for every mutant (stryker.config.mjs). The corpus tests heal
// every prefix of real documents: minutes per run under instrumentation, which
// every surviving mutant would pay. The generated property suite covers the same
// code in seconds; the corpus still runs in `pnpm test`.
export default mergeConfig(
  base,
  defineConfig({ test: { exclude: [...configDefaults.exclude, "__tests__/corpus*.test.ts"] } }),
);
