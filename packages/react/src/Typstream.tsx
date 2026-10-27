// <Typstream> (PLAN §7): a thin layer over @typstream/dom's mountTypstream.
// The div is React's; everything inside it belongs to the DOM renderers, which
// React never touches. The mount follows the component's lifetime (so it is
// StrictMode-safe: the second mount opens a fresh document), and every render
// passes the latest props to `update()`, which acts only on what changed.

import {
  type MountedTypstream,
  mountTypstream,
  registerMathFont,
  type StandaloneHtmlOptions,
  type TypstreamExportOptions,
  type TypstreamOptions,
} from "@typstream/dom";
import type { DocumentState, EngineDocument } from "@typstream/engine";
import { type CSSProperties, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { mergeDefaults, type TypstreamDefaults, useTypstreamDefaults } from "./context";
import { acquireEngine, releaseEngine } from "./engine";

/**
 * Props of {@link Typstream}: the document (`source` or `stream`), how to
 * compile and show it, and callbacks. Unset settings come from the nearest
 * {@link TypstreamProvider}, then the defaults.
 * @public
 */
export interface TypstreamProps
  extends TypstreamDefaults,
    Pick<TypstreamOptions, "source" | "stream" | "isStreaming" | "onStatusChange"> {
  /** Receives the instance's {@link TypstreamHandle}, e.g. `useTypstream().ref`. */
  ref?: Ref<TypstreamHandle>;
  /** Of the element the document renders into. */
  className?: string;
  /** Of the element the document renders into. */
  style?: CSSProperties;
  /** Of the element the document renders into. */
  id?: string;
}

/**
 * A `<Typstream>` instance, for reading its document from outside (see
 * {@link useTypstream}). The same object for the component's lifetime.
 * @public
 */
export interface TypstreamHandle {
  /** The element the document renders into, while mounted. */
  readonly element: HTMLElement | null;
  /** The engine document, once it has opened (documents open lazily, near the viewport). */
  readonly document: EngineDocument | null;
  /** The document's state; `null` before it opens. */
  getState(): DocumentState | null;
  /** Calls `listener` whenever `getState()` or `document` changes. */
  subscribe(listener: () => void): () => void;
  /**
   * Exports the document as PDF (#18), compiled by the engine that renders the
   * preview. It compiles with the template's inputs, the `inputs` prop and
   * `options.inputs` (a teacher's copy: `{ showAnswers: "true" }`), but not a
   * `layout="fit-width"` preview's page size, so it prints at the document's
   * own size. Opens a lazy document that hasn't opened yet. Rejects with the
   * engine's `ExportError`, or an `Error` when the component isn't mounted.
   */
  exportPdf(options?: TypstreamExportOptions): Promise<Uint8Array>;
  /**
   * Exports the document as an HTML file that opens on its own (see
   * `standaloneHtml` in `@typstream/dom`), with the component's plugins,
   * `stylesheets` and `theme`. `options` add to or override them (a `mathFont`,
   * a `title`). Otherwise as {@link TypstreamHandle.exportPdf}, `options.inputs`
   * included.
   */
  exportHtml(options?: StandaloneHtmlOptions & TypstreamExportOptions): Promise<string>;
  /**
   * The source the exports compile: the healed input, as a `.typ` file would
   * hold it. Opens a lazy document that hasn't opened yet. Throws when the
   * component isn't mounted.
   */
  exportSource(): string;
}

/**
 * A handle whose mount can come and go (StrictMode mounts twice). Exports go to
 * the current mount's, which leave out fit-width's page size (`document`'s don't).
 * @internal
 */
export const createHandle = () => {
  let mounted: MountedTypstream | null = null;
  let stop = () => {};
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const mount = () => {
    if (!mounted) throw new Error("<Typstream> isn't mounted");
    return mounted;
  };
  const handle: TypstreamHandle = {
    get element() {
      return mounted?.element ?? null;
    },
    get document() {
      return mounted?.document ?? null;
    },
    getState: () => mounted?.getState() ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    exportPdf: async (options) => mount().exportPdf(options),
    exportHtml: async (options) => mount().exportHtml(options),
    exportSource: () => mount().exportSource(),
  };
  const attach = (next: MountedTypstream | null) => {
    stop();
    mounted = next;
    stop = next ? next.subscribe(notify) : () => {};
    notify();
  };
  return { handle, attach };
};

/** Every MathML-capable document on the page shares one registration. */
const registered = new Set<string>();
const useMathFont = (url: string | URL | undefined) => {
  useEffect(() => {
    if (!url || registered.has(String(url))) return;
    registered.add(String(url));
    registerMathFont(url).catch((error) => {
      registered.delete(String(url));
      globalThis.reportError?.(error);
    });
  }, [url]);
};

/**
 * Renders a streaming Typst document: pass the text so far as `source` while
 * `isStreaming`, or a `stream` of chunks. Heals each prefix, compiles it in the
 * engine's worker and shows HTML (default) or pages, keeping the last good
 * output while a prefix doesn't compile.
 *
 * @example
 * ```tsx
 * <Typstream source={part.text} isStreaming={status === "streaming"} animated caret />
 * ```
 * @public
 */
export const Typstream = ({ ref, className, style, id, ...props }: TypstreamProps) => {
  const { engine: explicit, mathFont, ...options } = mergeDefaults(useTypstreamDefaults(), props);
  const element = useRef<HTMLDivElement>(null);
  const mounted = useRef<{ view: MountedTypstream; engine: TypstreamOptions["engine"] } | null>(null);
  const [{ handle, attach }] = useState(createHandle);
  useImperativeHandle(ref, () => handle, [handle]);
  useMathFont(mathFont);

  // Latest options for the mount effect, which runs only when the engine changes.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const engine = explicit ?? acquireEngine();
    const view = mountTypstream(el, { ...latest.current, engine });
    mounted.current = { view, engine };
    attach(view);
    return () => {
      attach(null);
      mounted.current = null;
      view.destroy();
      if (!explicit) releaseEngine();
    };
  }, [explicit, attach]);

  // Every render: the mount compares and applies only what changed.
  useEffect(() => {
    const m = mounted.current;
    if (m) m.view.update({ ...options, engine: m.engine });
  });

  return (
    <div ref={element} className={className ? `typstream-host ${className}` : "typstream-host"} style={style} id={id} />
  );
};
