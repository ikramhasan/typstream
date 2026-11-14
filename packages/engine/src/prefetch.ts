// `@typstream/engine/prefetch`: downloads what the default worker (worker.ts)
// loads at start, without starting it (PLAN §6.4). No worker, no wasm
// instance, no memory held: the files wait in the browser's caches until a
// worker asks for them. The base fonts go into the Cache Storage cache the
// worker reads them from (engine-wasm.ts's `fontCache`, keyed by URL), so they
// are found whatever the server's cache headers; the wasm goes through the
// HTTP cache, which the worker's `fetch` reads (bundlers emit it with a
// content hash, which hosts serve as immutable).
//
// Written as `new URL("…", import.meta.url)` in engine-wasm's modules, the
// URLs resolve to the same emitted files as the worker's.

import { baseFonts } from "@typstream/engine-wasm/fonts";
import { wasmUrl } from "@typstream/engine-wasm/wasm";

/** The parts of the Cache Storage API used here (the package compiles without DOM types). */
interface Caches {
  open(name: string): Promise<{
    match(key: string): Promise<unknown>;
    put(key: string, response: unknown): Promise<void>;
  }>;
}

/** The default worker's font cache (engine-wasm.ts's `fontCache` default). */
const FONT_CACHE = "typstream-fonts";

/** A fetch that doesn't compete with the app's own requests, where the browser takes the hint. */
const fetchLow = (url: URL): Promise<Response> => fetch(url, { priority: "low" } as RequestInit);

/** Reads the whole response, so the HTTP cache keeps it. */
const download = async (url: URL): Promise<void> => {
  const response = await fetchLow(url);
  if (!response.ok) throw new Error(`typstream: failed to prefetch ${url}: HTTP ${response.status}`);
  await response.arrayBuffer();
};

const prefetchFont = async (url: URL, cache: Awaited<ReturnType<Caches["open"]>> | null): Promise<void> => {
  if (!cache) return download(url);
  const key = String(url);
  if (await cache.match(key)) return;
  const response = await fetchLow(url);
  if (!response.ok) throw new Error(`typstream: failed to prefetch ${key}: HTTP ${response.status}`);
  await cache.put(key, response);
};

/**
 * Downloads the default engine worker's wasm and base fonts into the
 * browser's caches, without starting a worker: the cheap way to get ready
 * for a document that may come. The worker `engineWorker()` starts later
 * then loads them from the caches. Fetches at low priority; resolves when
 * both are cached, rejects if a download fails. Only for the default worker:
 * an engine on a server (`fromWebSocket`) downloads nothing.
 *
 * @example
 * ```ts
 * import { prefetchEngine } from "@typstream/engine/prefetch";
 * void prefetchEngine(); // at app start
 * ```
 * @public
 */
export const prefetchEngine = async (): Promise<void> => {
  const storage = (globalThis as { caches?: Caches }).caches;
  // Cache Storage throws in some contexts (opaque origins, private modes): the HTTP cache then.
  const cache = storage ? await storage.open(FONT_CACHE).catch(() => null) : null;
  await Promise.all([download(wasmUrl), ...baseFonts.map((url) => prefetchFont(url, cache))]);
};
