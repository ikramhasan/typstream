// The playground's engine: one worker for the page, spawned the first time the
// render pane needs it (so `render=off` never loads the 19 MB wasm), plus a log
// of its events for the inspector. Documents come and go with the source and
// settings (rawEngine.ts); the worker and its warm Typst caches stay.
import type { InitializeResult } from "@typstream/core";
import { createEngine, type Engine, type EngineEvent, engineWorker } from "@typstream/engine";

/** An engine event and when it happened (`performance.now()`). */
export interface LoggedEvent {
  at: number;
  event: EngineEvent;
}

/** Keep the newest events only: a log line per compile would grow without bound. */
const MAX_EVENTS = 50;

export interface EngineLog {
  /** The worker's `initialize` answer, once it is up. */
  info: InitializeResult | null;
  /** Newest first, without `ready` (that's `info`). */
  events: readonly LoggedEvent[];
}

let engine: Engine | null = null;
let log: EngineLog = { info: null, events: [] };
const listeners = new Set<() => void>();

export const sharedEngine = (): Engine => {
  if (engine) return engine;
  engine = createEngine({ spawn: engineWorker(), clientInfo: { name: "typstream-playground" } });
  engine.onEvent((event) => {
    log =
      event.type === "ready"
        ? { ...log, info: event.info }
        : { ...log, events: [{ at: performance.now(), event }, ...log.events].slice(0, MAX_EVENTS) };
    for (const listener of listeners) listener();
  });
  return engine;
};

/** For `useSyncExternalStore`. */
export const subscribeLog = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const engineLog = (): EngineLog => log;

// A hot update of this module would otherwise leave the old worker running.
import.meta.hot?.dispose(() => {
  engine?.dispose();
  engine = null;
});
