// The <Typstream> view's data for the inspector: the component's own document,
// read through useTypstream(), in the shape the raw engine view's hook gives
// (rawEngine.ts), so the inspector's engine sections show either.
import type { CompileResult } from "@typstream/core";
import type { TypstreamInfo } from "@typstream/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { engineLog, subscribeLog } from "./engine";
import type { RawEngine } from "./rawEngine";

/**
 * `healed` is the healed pane's source: <Typstream> heals the raw input
 * itself, with the same options, so its document should compile exactly that.
 */
export const useTypstreamEngine = (t: TypstreamInfo, healed: string | null): RawEngine => {
  const compiles = useRef<CompileResult[]>([]);
  // Every state, not just the ones React renders: a compile between two renders still counts.
  useEffect(() => {
    const handle = t.handle;
    compiles.current = [];
    if (!handle) return;
    let doc = handle.document;
    let last: CompileResult | null = null;
    return handle.subscribe(() => {
      if (handle.document !== doc) {
        doc = handle.document;
        compiles.current = [];
        last = null;
      }
      const compile = handle.getState()?.lastCompile ?? null;
      if (!compile || compile === last) return;
      last = compile;
      compiles.current = [...compiles.current, compile];
    });
  }, [t.handle]);
  const log = useSyncExternalStore(subscribeLog, engineLog);
  return { state: t.state, sent: healed, compiles: compiles.current, log };
};
