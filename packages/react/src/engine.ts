// The page's default engine: one worker shared by every <Typstream> that isn't
// given an engine (a chat history is many documents, PLAN §7), created on first
// use and disposed when nothing has used it for a moment. The delay keeps the
// worker (its wasm and fonts, its warm caches) through StrictMode's
// unmount-remount and through instances replacing each other across commits.

import { createEngine, type Engine, engineWorker } from "@typstream/engine";
import { useEffect, useState } from "react";

/** How long the default engine outlives its last user, ms. */
export const RELEASE_DELAY = 1000;

let factory = (): Engine => createEngine({ spawn: engineWorker(), clientInfo: { name: "@typstream/react" } });
let engine: Engine | null = null;
let users = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Takes a reference to the default engine, creating it if needed. Call from effects only. */
export const acquireEngine = (): Engine => {
  clearTimeout(timer);
  users++;
  engine ??= factory();
  return engine;
};

/** Gives back a reference from {@link acquireEngine}; the last one disposes the engine after {@link RELEASE_DELAY}. */
export const releaseEngine = (): void => {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (users > 0) return;
    engine?.dispose();
    engine = null;
  }, RELEASE_DELAY);
};

/** Tests: replace how the default engine is made, and see whether one is alive. */
export const defaultEngineForTests = {
  setFactory(make: () => Engine): void {
    factory = make;
  },
  current: (): Engine | null => engine,
  users: (): number => users,
};

/**
 * The engine a component here compiles with: `engine` if given, else the page's default engine (shared with every
 * `<Typstream>` given none), taken while the component is mounted. `null` until the component has mounted.
 * @beta
 */
export const useTypstreamEngine = (engine?: Engine): Engine | null => {
  const [shared, setShared] = useState<Engine | null>(null);
  useEffect(() => {
    if (engine) return;
    setShared(acquireEngine());
    return () => {
      setShared(null);
      releaseEngine();
    };
  }, [engine]);
  return engine ?? shared;
};
