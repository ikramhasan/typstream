// Wasm size budget (PLAN.md §11.6): brotli -q 11 of dist/engine_bg.wasm, as in the Phase 0 measurements.
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";

const BUDGET_BR = 6_000_000;
const wasm = readFileSync(new URL("../dist/engine_bg.wasm", import.meta.url));
const br = brotliCompressSync(wasm, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    // The brotli CLI's default window, which the Phase 0 numbers used (Node's default is 22).
    [constants.BROTLI_PARAM_LGWIN]: 24,
    [constants.BROTLI_PARAM_SIZE_HINT]: wasm.length,
  },
}).length;
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
console.log(`@typstream/engine-wasm: ${mb(wasm.length)} wasm, ${mb(br)} brotli (budget ${mb(BUDGET_BR)})`);
process.exitCode = br <= BUDGET_BR ? 0 : 1;
