// The page's default engine: shared by every user, disposed a moment after the last one leaves.
import type { Engine } from "@typstream/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireEngine, defaultEngineForTests, RELEASE_DELAY, releaseEngine } from "../src/engine";

const fakeEngine = () => ({ dispose: vi.fn() }) as unknown as Engine & { dispose: ReturnType<typeof vi.fn> };

describe("default engine", () => {
  let made: ReturnType<typeof fakeEngine>[];
  beforeEach(() => {
    vi.useFakeTimers();
    made = [];
    defaultEngineForTests.setFactory(() => {
      const engine = fakeEngine();
      made.push(engine);
      return engine;
    });
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("is one engine for every user", () => {
    const a = acquireEngine();
    const b = acquireEngine();
    expect(a).toBe(b);
    expect(made).toHaveLength(1);
    releaseEngine();
    releaseEngine();
  });

  it("is disposed after the last user leaves", () => {
    acquireEngine();
    releaseEngine();
    expect(made[0]?.dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RELEASE_DELAY);
    expect(made[0]?.dispose).toHaveBeenCalledOnce();
    expect(defaultEngineForTests.current()).toBeNull();
  });

  it("survives a release and acquire in a row (StrictMode, instances replacing each other)", () => {
    const first = acquireEngine();
    releaseEngine();
    const second = acquireEngine();
    vi.advanceTimersByTime(RELEASE_DELAY * 2);
    expect(second).toBe(first);
    expect(first.dispose).not.toHaveBeenCalled();
    releaseEngine();
    vi.advanceTimersByTime(RELEASE_DELAY);
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it("makes a new engine after the old one was disposed", () => {
    const first = acquireEngine();
    releaseEngine();
    vi.advanceTimersByTime(RELEASE_DELAY);
    const second = acquireEngine();
    expect(second).not.toBe(first);
    releaseEngine();
  });
});
