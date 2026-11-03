/// <reference lib="dom" />
// The real engine worker for browser tests, spawned from the engine's source (`engineWorker()` points at the built
// worker.js).

import { createEngine, type Engine, fromWorker } from "@typstream/engine";

export interface Entry {
  name: string;
  source: string;
  files?: Record<string, string>;
}

declare module "vitest/browser" {
  interface BrowserCommands {
    corpusEntries(): Promise<Entry[]>;
    eduExamples(): Promise<Entry[]>;
  }
}

export const startEngine = (): Engine =>
  createEngine({
    spawn: fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" })),
    spare: false,
  });
