// Shared tsup preset. A package's tsup.config.ts is `export default packageConfig();`,
// with overrides for extra entry points (e.g. `@typstream/engine/worker`).
import { defineConfig, type Options } from "tsup";

export const packageConfig = (overrides: Options = {}) =>
  defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    // One bundled .d.ts per entry: what api-extractor and attw read.
    dts: true,
    clean: true,
    ...overrides,
  });
