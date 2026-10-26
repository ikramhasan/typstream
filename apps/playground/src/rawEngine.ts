// The raw engine view's data: one EngineDocument fed the healed source of the
// current step. Every step is a `set()`; the engine's scheduler decides when to
// compile (latest wins, adaptive interval), so playback at any speed costs one
// compile at a time. The document heals again what it's given; healing is
// idempotent, so it compiles the source the healed pane shows, and diagnostics
// come back in that pane's coordinates.
import type { CompileResult, CompileTarget } from "@typstream/core";
import type { DocumentState, EngineDocument } from "@typstream/engine";
import type { HealOptions } from "@typstream/heal";
import { htmlCompat } from "@typstream/html-compat";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type EngineLog, engineLog, sharedEngine, subscribeLog } from "./engine";

export interface RawEngineOptions {
  enabled: boolean;
  /** A new document (and fresh compile statistics) whenever this changes: the loaded stream. */
  docKey: string | null;
  /** Healed source of the current step. */
  source: string | null;
  /** Compile in final mode (`finish()`), as the inspector's final-mode checkbox heals. */
  final: boolean;
  target: CompileTarget;
  compat: boolean;
  /** Fixed for a document's lifetime: a change opens a new one. */
  heal: HealOptions;
}

export interface RawEngine {
  /** The document's latest state; null while the view is off or nothing is loaded. */
  state: DocumentState | null;
  /** What was last `set()`, to check the engine's own heal left it alone. */
  sent: string | null;
  /** Every compile this document finished, oldest first. */
  compiles: readonly CompileResult[];
  log: EngineLog;
}

const noSubscription = () => () => {};

export const useRawEngine = (options: RawEngineOptions): RawEngine => {
  const { enabled, docKey, source, final, target, compat, heal } = options;
  const [doc, setDoc] = useState<EngineDocument | null>(null);
  const compiles = useRef<CompileResult[]>([]);
  const sent = useRef<string | null>(null);
  /** Whether the document has been `finish()`ed: leaving final mode is a `reset()`. */
  const finished = useRef(false);
  // The document opens with the current target; later changes go through setTarget.
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!enabled || docKey === null) return;
    const opened = sharedEngine().open({
      target: targetRef.current,
      heal,
      ...(compat ? { preamble: htmlCompat.engine?.preamble, files: htmlCompat.engine?.files } : {}),
    });
    compiles.current = [];
    sent.current = null;
    finished.current = false;
    let last: CompileResult | null = null;
    const stop = opened.subscribe((s) => {
      if (!s.lastCompile || s.lastCompile === last) return;
      last = s.lastCompile;
      compiles.current = [...compiles.current, s.lastCompile];
    });
    setDoc(opened);
    return () => {
      stop();
      opened.dispose();
      setDoc(null);
    };
  }, [enabled, docKey, compat, heal]);

  useEffect(() => doc?.setTarget(target), [doc, target]);

  useEffect(() => {
    if (!doc || source === null) return;
    sent.current = source;
    if (final && !finished.current) {
      doc.set(source);
      doc.finish();
    } else if (!final && finished.current) {
      doc.reset(source);
    } else {
      // After finish(), later input keeps compiling in final mode.
      doc.set(source);
    }
    finished.current = final;
  }, [doc, source, final]);

  const subscribe = useCallback((listener: () => void) => (doc ? doc.subscribe(listener) : noSubscription()), [doc]);
  const state = useSyncExternalStore(subscribe, () => doc?.getState() ?? null);
  const log = useSyncExternalStore(subscribeLog, engineLog);
  return { state, sent: sent.current, compiles: compiles.current, log };
};
