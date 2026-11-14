// preloadTypstream(): the page's default engine started and warmed before a
// <Typstream> needs it, kept for `holdMs`, or only its files downloaded.
import type { Engine } from "@typstream/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEngineForTests, RELEASE_DELAY } from "../src/engine";
import { PRELOAD_HOLD_MS, preloadTypstream } from "../src/preload";

const prefetch = vi.hoisted(() => ({ prefetchEngine: vi.fn(() => Promise.resolve()) }));
vi.mock("@typstream/engine/prefetch", () => prefetch);

type FakeEngine = Engine & { dispose: ReturnType<typeof vi.fn>; preload: ReturnType<typeof vi.fn> };

describe("preloadTypstream", () => {
  let made: FakeEngine[];
  let warm: Promise<void>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", class {});
    made = [];
    warm = Promise.resolve();
    prefetch.prefetchEngine.mockClear();
    defaultEngineForTests.setFactory(() => {
      const engine = { dispose: vi.fn(), preload: vi.fn(() => warm) } as unknown as FakeEngine;
      made.push(engine);
      return engine;
    });
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts the default engine and warms it with the options, without its own", async () => {
    const plugin = { key: "acme" };
    const preload = preloadTypstream({ plugins: [plugin], targets: ["paged"], holdMs: 5 });
    expect(made).toHaveLength(1);
    expect(made[0]?.preload).toHaveBeenCalledWith({ plugins: [plugin], targets: ["paged"] });
    await expect(preload.ready).resolves.toBeUndefined();
    expect(prefetch.prefetchEngine).not.toHaveBeenCalled();
  });

  it("keeps the engine for holdMs, then lets it go", () => {
    preloadTypstream();
    vi.advanceTimersByTime(PRELOAD_HOLD_MS - 1);
    expect(defaultEngineForTests.users()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(defaultEngineForTests.users()).toBe(0);
    vi.advanceTimersByTime(RELEASE_DELAY);
    expect(made[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("lets go at release(), once", () => {
    const a = preloadTypstream();
    const b = preloadTypstream();
    expect(made).toHaveLength(1);
    expect(defaultEngineForTests.users()).toBe(2);
    a.release();
    a.release();
    expect(defaultEngineForTests.users()).toBe(1);
    b.release();
    vi.advanceTimersByTime(PRELOAD_HOLD_MS);
    expect(defaultEngineForTests.users()).toBe(0);
  });

  it("keeps the engine until release() with holdMs Infinity", () => {
    const preload = preloadTypstream({ holdMs: Number.POSITIVE_INFINITY });
    vi.advanceTimersByTime(PRELOAD_HOLD_MS * 10);
    expect(defaultEngineForTests.users()).toBe(1);
    preload.release();
    expect(defaultEngineForTests.users()).toBe(0);
  });

  it("only downloads the files at the fetch level", async () => {
    const preload = preloadTypstream({ level: "fetch" });
    expect(made).toHaveLength(0);
    await expect(preload.ready).resolves.toBeUndefined();
    // Through `import()`: the entry loads only for this level.
    expect(prefetch.prefetchEngine).toHaveBeenCalledOnce();
  });

  it("does nothing where there are no workers (a server)", async () => {
    vi.stubGlobal("Worker", undefined);
    const preload = preloadTypstream();
    expect(made).toHaveLength(0);
    await expect(preload.ready).resolves.toBeUndefined();
    preload.release();
  });

  it("passes a failure on through ready, without an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    warm = Promise.reject(new Error("no engine"));
    warm.catch(() => {});
    const ignored = preloadTypstream();
    const watched = preloadTypstream();
    await expect(watched.ready).rejects.toThrow("no engine");
    await vi.advanceTimersByTimeAsync(0);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
    ignored.release();
    watched.release();
  });
});
