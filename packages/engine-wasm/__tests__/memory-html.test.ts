// Streaming 200 growing sources must not grow wasm memory: the engine evicts
// comemo's cache after every compile. Without eviction Phase 0 measured
// +3.7 MiB per compile (756 MiB after 200). Its own file, so its own
// wasm instance: memory is a high-water mark for the whole instance.
import { expect, it } from "vitest";
import { streamingSteps } from "./support/documents.js";
import { Engine, newEngine } from "./support/engine.js";

const MIB = 1024 * 1024;

it("keeps HTML memory flat over 200 compiles", () => {
  const engine = newEngine();
  const samples: number[] = [];
  let step = 0;
  for (const source of streamingSteps(200)) {
    engine.set_source("/main.typ", source);
    expect(engine.compile_html().ok).toBe(true);
    if (++step % 50 === 0) samples.push(Engine.memory_bytes() / MIB);
  }
  const [at50 = 0, , , at200 = 0] = samples;
  expect(at200 - at50, `MiB at compiles 50/100/150/200: ${samples.join(", ")}`).toBeLessThanOrEqual(8);
  expect(at200).toBeLessThan(128);
});
