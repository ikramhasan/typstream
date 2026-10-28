// useTypstream (PLAN §7): a <Typstream>'s live state, for status lines,
// diagnostics panels and "the model is still writing a table…" hints. React
// refs don't announce when they are set, so the hook hands out its own
// callback ref instead of reading one: `<Typstream ref={t.ref} />`.

import type { Diagnostic } from "@typstream/core";
import type { StandaloneHtmlOptions, TypstreamExportOptions } from "@typstream/dom";
import type { DocumentState, DocumentStatus, EngineDocument } from "@typstream/engine";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createHandle, type TypstreamHandle } from "./Typstream";

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
  /**
   * The engine document. For exports, prefer `exportPdf()` and friends: the
   * document's own exports use its inputs, which include a reflow preview's
   * page size.
   */
  document: EngineDocument | null;
  /**
   * Exports the document as PDF, at its own page size (a reflow preview's
   * width left out), with the template's inputs, the `inputs` prop and
   * `options.inputs`. Opens a lazy document that hasn't opened yet. Rejects
   * with the engine's `ExportError`, or an `Error` when no `<Typstream>` is
   * mounted. See {@link TypstreamHandle.exportPdf}.
   */
  exportPdf(options?: TypstreamExportOptions): Promise<Uint8Array>;
  /** Exports the document as an editable DOCX file. See {@link TypstreamHandle.exportDocx}. @beta */
  exportDocx(options?: TypstreamExportOptions): Promise<Uint8Array>;
  /**
   * Exports the document as an HTML file that opens on its own, with the
   * component's plugins, `stylesheets` and `theme`; `options` add to or
   * override them. See {@link TypstreamHandle.exportHtml}.
   */
  exportHtml(options?: StandaloneHtmlOptions & TypstreamExportOptions): Promise<string>;
  /** The healed source the exports compile. Throws when no `<Typstream>` is mounted. */
  exportSource(): string;
}

const EMPTY: never[] = [];
const noSubscription = () => () => {};

/**
 * Reads a `<Typstream>`'s document: status, diagnostics, healed source; and
 * exports it (`exportPdf()`, `exportHtml()`, `exportSource()`, as on
 * {@link TypstreamHandle}).
 *
 * @example
 * ```tsx
 * const t = useTypstream();
 * return (
 *   <>
 *     <Typstream ref={t.ref} source={text} isStreaming />
 *     {t.status === "stale" ? <p>Showing the last good render…</p> : null}
 *     <button onClick={async () => save(await t.exportPdf())}>Download PDF</button>
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
  return useMemo(() => {
    // Until `ref` receives the instance, a detached handle's exports fail as an unmounted one's do.
    const { exportPdf, exportDocx, exportHtml, exportSource } = handle ?? createHandle().handle;
    return {
      ref: setHandle,
      handle,
      state,
      status: state?.status ?? "idle",
      diagnostics: state?.diagnostics ?? EMPTY,
      healedSource: state?.heal.source ?? "",
      openFrames: state?.heal.openFrames ?? EMPTY,
      document,
      exportPdf,
      exportDocx,
      exportHtml,
      exportSource,
    };
  }, [handle, state, document]);
};
