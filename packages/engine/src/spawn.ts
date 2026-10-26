// Spawns the default engine worker (worker.ts, built to worker.js next to this
// module). Written exactly as `new Worker(new URL("./worker.js", import.meta.url), …)`
// so bundlers (Vite, webpack, Turbopack) find the worker, bundle it, and emit
// the wasm and fonts it references as assets.

import { fromWorker, type SpawnEngine, type WorkerLike } from "./connection";

// The DOM's Worker, declared here so the package needs no DOM types.
declare const Worker: new (url: URL, options: { type: "module"; name?: string }) => WorkerLike;

/**
 * Spawns the default engine worker: engine-wasm (Typst 0.15.1) with the base
 * fonts. Pass it to {@link createEngine} in a browser.
 *
 * @example
 * ```ts
 * import { createEngine, engineWorker } from "@typstream/engine";
 * const engine = createEngine({ spawn: engineWorker() });
 * ```
 * @public
 */
export const engineWorker = (): SpawnEngine =>
  fromWorker(() => new Worker(new URL("./worker.js", import.meta.url), { type: "module", name: "typstream-engine" }));
