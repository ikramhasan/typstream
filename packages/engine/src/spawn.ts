// Spawns the default engine worker (worker.ts, built to worker.js next to this
// module). Written exactly as `new Worker(new URL("./worker.js", import.meta.url), …)`
// so bundlers (Vite, webpack, Turbopack) find the worker, bundle it, and emit
// the wasm and fonts it references as assets.

import { trustedScriptURL } from "@typstream/core";
import { fromWorker, type SpawnEngine, type WorkerLike } from "./connection";

type WorkerConstructor = new (url: URL | string, options: { type: "module"; name?: string }) => WorkerLike;

// The DOM's Worker, declared here so the package needs no DOM types.
declare const Worker: WorkerConstructor;

/**
 * Runs `spawn` with the global `Worker` taking its URL through typstream's
 * Trusted Types policy (#70): pages with `require-trusted-types-for 'script'`
 * refuse a plain URL there. The URL can't be wrapped where it is written,
 * since bundlers find the worker only in `new Worker(new URL("…", import.meta.url))`.
 */
const trusted = (spawn: () => WorkerLike): WorkerLike => {
  const scope = globalThis as { Worker?: WorkerConstructor; trustedTypes?: unknown };
  const Native = scope.Worker;
  if (!Native || !scope.trustedTypes) return spawn();
  scope.Worker = class extends Native {
    constructor(url: URL | string, options: { type: "module"; name?: string }) {
      super(trustedScriptURL(String(url)), options);
    }
  };
  try {
    return spawn();
  } finally {
    scope.Worker = Native;
  }
};

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
  fromWorker(() =>
    trusted(() => new Worker(new URL("./worker.js", import.meta.url), { type: "module", name: "typstream-engine" })),
  );
