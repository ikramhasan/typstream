// `prefetchEngine()` (@typstream/engine/prefetch): the default worker's wasm
// downloaded whole (HTTP cache), its base fonts put in the Cache Storage cache
// the worker reads them from, under the keys it looks them up by.

import { baseFonts } from "@typstream/engine-wasm/fonts";
import { wasmUrl } from "@typstream/engine-wasm/wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps the page's prefetch: each test loads it afresh.
let prefetchEngine: () => Promise<void>;
beforeEach(async () => {
  vi.resetModules();
  ({ prefetchEngine } = await import("../src/prefetch"));
});

const stubFetch = (status = 200) => {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (url: URL, init?: { priority?: string }) => {
    fetched.push(`${String(url)} ${init?.priority}`);
    return new Response("bytes", { status });
  });
  return fetched;
};

const stubCaches = (cached: string[] = []) => {
  const stored = new Map<string, Map<string, unknown>>();
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      const cache = stored.get(name) ?? new Map<string, unknown>(cached.map((key) => [key, "old"]));
      stored.set(name, cache);
      return {
        match: async (key: string) => cache.get(key),
        put: async (key: string, response: unknown) => void cache.set(key, response),
      };
    },
  });
  return stored;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefetchEngine", () => {
  it("downloads the wasm and puts the base fonts in the worker's font cache, at low priority", async () => {
    const fetched = stubFetch();
    const stored = stubCaches();
    await prefetchEngine();
    expect(fetched).toContain(`${wasmUrl} low`);
    expect([...(stored.get("typstream-fonts")?.keys() ?? [])].sort()).toEqual(baseFonts.map(String).sort());
    expect(fetched).toHaveLength(1 + baseFonts.length);
  });

  it("doesn't fetch fonts the cache has", async () => {
    const fetched = stubFetch();
    stubCaches(baseFonts.map(String));
    await prefetchEngine();
    expect(fetched).toEqual([`${wasmUrl} low`]);
  });

  it("fetches everything through the HTTP cache without Cache Storage", async () => {
    const fetched = stubFetch();
    vi.stubGlobal("caches", undefined);
    await prefetchEngine();
    expect(fetched).toHaveLength(1 + baseFonts.length);
  });

  it("rejects when a download fails, and tries again on the next call", async () => {
    stubFetch(404);
    stubCaches();
    await expect(prefetchEngine()).rejects.toThrow(/HTTP 404/);
    const fetched = stubFetch();
    await prefetchEngine();
    expect(fetched).toContain(`${wasmUrl} low`);
  });

  it("fetches once for every call after the first", async () => {
    const fetched = stubFetch();
    stubCaches();
    const first = prefetchEngine();
    expect(prefetchEngine()).toBe(first);
    await first;
    await prefetchEngine();
    expect(fetched.filter((f) => f.startsWith(String(wasmUrl)))).toHaveLength(1);
  });
});
