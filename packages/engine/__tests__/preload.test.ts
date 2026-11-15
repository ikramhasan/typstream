// Warming the engine before a document needs it (PLAN §6.4): `engine.preload()`
// compiles throwaway documents, loading what their plugins bring into the
// worker, and closes them; the compiles it chooses (`preloadCompiles`).

import { definePlugin } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { createEngine, type EngineEvent } from "../src/engine";
import { preloadCompiles } from "../src/preload";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";
import { FakeWorkers } from "./support/fake-worker";

const loads = globalThis as { __preloadLoads?: Record<string, number> };

/** A fixer module that counts its loads under `name`, and fixes nothing. */
const countingModule = (name: string) =>
  `data:text/javascript,${encodeURIComponent(
    `const l = (globalThis.__preloadLoads ??= {}); l[${JSON.stringify(name)}] = (l[${JSON.stringify(name)}] ?? 0) + 1; export default [];`,
  )}`;

const example = (key: string, output: string) =>
  definePlugin({
    key,
    prompt: {
      examples: [
        { title: "first", output },
        { title: "second", output: "#second" },
      ],
    },
  });

describe("preloadCompiles", () => {
  it("compiles the sample in every target, then each plugin's first example in the first", () => {
    const compiles = preloadCompiles({ plugins: [example("a", "#a"), definePlugin({ key: "b" }), example("c", "#c")] });
    expect(compiles.map((c) => c.target)).toEqual(["html", "paged", "html", "html"]);
    expect(compiles.slice(2).map((c) => c.text)).toEqual(["#a", "#c"]);
    expect(compiles[0]?.text).toBe(compiles[1]?.text);
  });

  it("takes the targets given, and `text` instead of the sample and examples", () => {
    expect(preloadCompiles({ targets: ["paged"], plugins: [example("a", "#a")] }).map((c) => c.target)).toEqual([
      "paged",
      "paged",
    ]);
    expect(preloadCompiles({ text: "Hi", targets: ["html", "paged"], plugins: [example("a", "#a")] })).toEqual([
      { text: "Hi", target: "html" },
      { text: "Hi", target: "paged" },
    ]);
    // No targets is the default, not nothing.
    expect(preloadCompiles({ targets: [] })).toHaveLength(2);
  });
});

describe("engine.preload", { timeout: 30_000 }, () => {
  it("loads the plugins' modules in the worker before any document opens, and compiles", async () => {
    const plugin = definePlugin({ key: "acme/warm", engine: { fixerModules: [countingModule("warm")] } });
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));
    await engine.preload({ plugins: [plugin] });
    expect(loads.__preloadLoads?.warm).toBe(1);
    // Two warm-up documents compiled, one per target, and both succeeded.
    const compiles = events.flatMap((e) =>
      e.type === "document" && e.event.type === "compiled" ? [e.event.status] : [],
    );
    expect(compiles).toEqual(["ok", "ok"]);
    // A real document opened afterwards compiles with the module already there.
    const doc = engine.open({ plugins: [plugin], text: "Hello" });
    doc.finish();
    await new Promise<void>((resolve) => doc.subscribe((s) => s.status === "done" && resolve()));
    expect(loads.__preloadLoads?.warm).toBe(1);
    engine.dispose();
  });

  it("warms other plugins again, though they add no compile of their own", async () => {
    const plugin = definePlugin({ key: "acme/late", engine: { fixerModules: [countingModule("late")] } });
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const plain = engine.preload();
    const withPlugin = engine.preload({ plugins: [plugin] });
    expect(withPlugin).not.toBe(plain);
    await withPlugin;
    expect(loads.__preloadLoads?.late).toBe(1);
    // Likewise with `text`, which replaces the plugins' examples.
    expect(engine.preload({ text: "Hi", targets: ["html"], plugins: [plugin] })).not.toBe(
      engine.preload({ text: "Hi", targets: ["html"] }),
    );
    await plain;
    engine.dispose();
  });

  it("returns the first call's promise for the same warm-up, and warms a different one", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const first = engine.preload({ targets: ["html"] });
    expect(engine.preload({ targets: ["html"] })).toBe(first);
    expect(engine.preload({ targets: ["paged"] })).not.toBe(first);
    await first;
    engine.dispose();
  });

  it("resolves when a warm-up document fails to compile", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    await expect(engine.preload({ text: "#nope(", targets: ["html"] })).resolves.toBeUndefined();
    engine.dispose();
  });

  it("rejects when the engine can't start, without an unhandled rejection when ignored", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    const engine = createEngine({ spawn: new FakeWorkers({ protocolVersion: 999 }).spawn, spare: false });
    void engine.preload({ targets: ["html"] });
    await expect(engine.preload({ targets: ["paged"] })).rejects.toThrow(/protocol 999/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", listener);
    expect(unhandled).toEqual([]);
    engine.dispose();
  });

  it("resolves when the engine is disposed before its worker is up", async () => {
    const engine = createEngine({ spawn: new FakeWorkers({ initMs: 200 }).spawn, spare: false });
    const warm = engine.preload();
    engine.dispose();
    await expect(warm).resolves.toBeUndefined();
  });

  it("resolves when the engine is disposed under it", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const warm = engine.preload();
    await engine.ready;
    engine.dispose();
    await expect(warm).resolves.toBeUndefined();
    // And a preload after `dispose()` has nothing to do.
    await expect(engine.preload({ text: "later" })).resolves.toBeUndefined();
  });
});
