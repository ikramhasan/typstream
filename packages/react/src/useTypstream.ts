// useTypstream (PLAN §7): a <Typstream>'s live state, for status lines,
// diagnostics panels and "the model is still writing a table…" hints. React
// refs don't announce when they are set, so the hook hands out its own
// callback ref instead of reading one: `<Typstream ref={t.ref} />`.

import type { Diagnostic } from "@typstream/core";
import type { DocumentState, DocumentStatus, EngineDocument } from "@typstream/engine";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { TypstreamHandle } from "./Typstream";

/** What {@link useTypstream} returns. @public */
export interface TypstreamInfo {
  /** Pass to `<Typstream ref>`. Stable. */
  ref: (handle: TypstreamHandle | null) => void;
  /** The instance, once mounted. */
  handle: TypstreamHandle | null;
  /** The document's whole state; `null` until it opens. */
  state: DocumentState | null;
  /** `idle` until the document opens. */
  status: DocumentStatus;
  /** Diagnostics of the latest compile, in `source` coordinates. */
  diagnostics: readonly Diagnostic[];
  /** The healed source the engine compiles (empty until the document opens). */
  healedSource: string;
  /** Constructs still open at the end of the input, innermost first. */
  openFrames: DocumentState["heal"]["openFrames"];
  /** The engine document: what exports (#18) go through. */
  document: EngineDocument | null;
  // Exports (#18): `exportPdf()` and friends belong here, calling the document's
  // export request (protocol `document/export`) at its current revision.
}

const EMPTY: never[] = [];
const noSubscription = () => () => {};

/**
 * Reads a `<Typstream>`'s document: status, diagnostics, healed source.
 *
 * @example
 * ```tsx
 * const t = useTypstream();
 * return (
 *   <>
 *     <Typstream ref={t.ref} source={text} isStreaming />
 *     {t.status === "stale" ? <p>Showing the last good render…</p> : null}
 *   </>
 * );
 * ```
 * @public
 */
export const useTypstream = (): TypstreamInfo => {
  const [handle, setHandle] = useState<TypstreamHandle | null>(null);
  const subscribe = useCallback((listener: () => void) => handle?.subscribe(listener) ?? noSubscription(), [handle]);
  const read = () => handle?.getState() ?? null;
  const state = useSyncExternalStore(subscribe, read, () => null);
  const document = handle?.document ?? null;
  return useMemo(
    () => ({
      ref: setHandle,
      handle,
      state,
      status: state?.status ?? "idle",
      diagnostics: state?.diagnostics ?? EMPTY,
      healedSource: state?.heal.source ?? "",
      openFrames: state?.heal.openFrames ?? EMPTY,
      document,
    }),
    [handle, state, document],
  );
};
