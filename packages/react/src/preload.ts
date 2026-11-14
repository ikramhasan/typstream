// Getting the engine ready before a <Typstream> needs it (PLAN §6.4,
// mitigation 2): the first document on a page otherwise waits for the wasm
// (~6 MB) and fonts to download and compile. An app that knows a document is
// coming (the user opened "Generate", a model is answering) starts that work
// early, on the page's default engine, the one every <Typstream> without an
// `engine` shares (./engine.ts): the first one to mount finds it warm.

import type { PreloadOptions } from "@typstream/engine";
import { useEffect, useRef } from "react";
import { acquireEngine, releaseEngine } from "./engine";

/** How long {@link preloadTypstream} keeps the default engine for documents to come, by default: a minute. @beta */
export const PRELOAD_HOLD_MS = 60_000;

/**
 * Options of {@link preloadTypstream} and {@link usePreloadTypstream}: what
 * to warm (the engine's `PreloadOptions`), and how far to go.
 * @beta
 */
export interface PreloadTypstreamOptions extends PreloadOptions {
  /**
   * `engine` (default): start the default engine's worker, compile the wasm,
   * load the fonts and compile warm-up documents with `plugins`, so the
   * first document renders at once. `fetch`: only download the wasm and base
   * fonts into the browser's caches, with no worker and no memory held, for
   * a document that may never come.
   */
  level?: "engine" | "fetch";
  /**
   * `engine` level: how long, in ms, to keep the engine for documents to come
   * when none mounts, before letting it go (a `<Typstream>` mounted meanwhile
   * keeps it for as long as it needs it). Default {@link PRELOAD_HOLD_MS};
   * `Infinity` keeps it until `release()`.
   */
  holdMs?: number;
}

/**
 * A preload under way: {@link preloadTypstream}'s answer.
 * @beta
 */
export interface TypstreamPreload {
  /**
   * Resolves when the engine is warm (`fetch`: when the files are cached).
   * Rejects if the engine can't start or a download fails; ignoring it is
   * safe, nothing is reported as unhandled.
   */
  readonly ready: Promise<void>;
  /** Lets go of the engine now rather than after `holdMs`. Later calls do nothing. */
  release(): void;
}

/** A preload that has nothing to do: on a server, where there are no workers. */
const nothing = (): TypstreamPreload => ({ ready: Promise.resolve(), release: () => {} });

/**
 * Gets typstream ready before the first `<Typstream>` mounts: call it when a
 * document is likely soon, such as when the user opens the "Generate" dialog
 * or sends the prompt. At the `engine` level it starts the page's default
 * engine (the one every `<Typstream>` without an `engine` uses), compiles
 * warm-up documents with `plugins` and keeps the engine for `holdMs`; at the
 * `fetch` level it only downloads the engine's files. Does nothing on a
 * server.
 *
 * @example
 * ```tsx
 * import { preloadTypstream } from "@typstream/react";
 *
 * <button onClick={() => { preloadTypstream({ plugins: [edu] }); generate(); }}>Generate</button>
 * ```
 * @beta
 */
export const preloadTypstream = (options: PreloadTypstreamOptions = {}): TypstreamPreload => {
  if (typeof (globalThis as { Worker?: unknown }).Worker === "undefined") return nothing();
  const { level = "engine", holdMs = PRELOAD_HOLD_MS, ...warm } = options;
  if (level === "fetch") {
    // Loaded only here: it brings engine-wasm's font list (about 2.5 KB), which other apps never need.
    const ready = import("@typstream/engine/prefetch").then((m) => m.prefetchEngine());
    ready.catch(() => {});
    return { ready, release: () => {} };
  }
  const engine = acquireEngine();
  let held = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (!held) return;
    held = false;
    clearTimeout(timer);
    releaseEngine();
  };
  if (Number.isFinite(holdMs)) timer = setTimeout(release, Math.max(0, holdMs));
  const ready = engine.preload(warm);
  ready.catch(() => {});
  return { ready, release };
};

/**
 * {@link preloadTypstream} for a component: while it is mounted and `when`
 * is true, the default engine is kept warm for the `<Typstream>`s to come
 * (for the whole time, not `holdMs`), then let go a moment after. Put it in
 * the screen that leads to a document: a chat's composer, a "Generate"
 * dialog (`usePreloadTypstream(open)`). `options` are read when `when` turns
 * true; changing them later warms nothing new, except `level`.
 * @beta
 */
export const usePreloadTypstream = (when = true, options: PreloadTypstreamOptions = {}): void => {
  const latest = useRef(options);
  latest.current = options;
  const level = options.level ?? "engine";
  useEffect(() => {
    if (!when) return;
    return preloadTypstream({ ...latest.current, level, holdMs: Infinity }).release;
  }, [when, level]);
};
