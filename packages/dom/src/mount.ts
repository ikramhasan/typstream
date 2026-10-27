// mountTypstream (PLAN §4.1, §7): a streaming Typst document in an element,
// with no framework. It opens a document on an engine, feeds it a growing
// `source` or a `stream` of chunks, and shows each artifact with the renderer
// for its target. The React bindings are a thin layer over it, calling
// `update()` with their props on every render, so every option can change at
// any time and `update()` only acts on what differs.
//
// Documents compile only while their element is near the viewport or they are
// streaming (`lazy`): a chat history of fifty finished answers shares one worker,
// and only the visible ones are opened and compiled.

import {
  type CompiledEvent,
  type CompileTarget,
  type Diagnostic,
  type DocumentEvent,
  type FallbackEvent,
  type FileDelta,
  type RenderedEvent,
  resolvePlugins,
  type TemplateSpec,
  type TypstreamPlugin,
  type WatchdogEvent,
} from "@typstream/core";
import type { DocumentOptions, DocumentState, DocumentStatus, Engine, EngineDocument } from "@typstream/engine";
import { type StandaloneHtmlOptions, standaloneHtml } from "./export/standalone";
import type { AnimateOptions } from "./html/animate";
import { createHtmlRenderer, type HtmlRenderer } from "./html/renderer";
import { FIT_WIDTH_PREAMBLE, fitWidthInputs } from "./paged/mount";
import { createPagedView, type PagedView } from "./paged/view";

/** Options of {@link mountTypstream}. @public */
export interface TypstreamOptions {
  /** Compiles the document. Documents on one engine share its worker and compile one at a time. */
  engine: Engine;
  /** The document so far: its whole text, growing while it streams. */
  source?: string;
  /**
   * Chunks to read instead of `source`. The document starts over when a new
   * stream is given, and is complete when the stream ends.
   */
  stream?: AsyncIterable<string> | null;
  /**
   * More `source` is coming. While false (default) the source is complete and
   * compiles strictly (final mode); going back to true starts the document over.
   */
  isStreaming?: boolean;
  /** Default `html`. */
  target?: CompileTarget;
  /** Paged target: pages at their own size (`fixed`, default) or as wide as the element (`fit-width`). */
  layout?: "fixed" | "fit-width";
  /** Paged `fit-width` layout: `a4` proportions (default) or one page as tall as the content (`auto`). */
  pageHeight?: "a4" | "auto";
  /** Typst evaluated before the document, after the plugins' and the template's. */
  preamble?: string;
  /**
   * Name of a template from the plugins' `templates` (the last plugin's, if
   * two have one by that name): its preamble and default inputs apply.
   */
  template?: string;
  /** `sys.inputs`, over the template's. */
  inputs?: Record<string, string>;
  /** Files the document reads (images, data), relative to its root. */
  files?: FileDelta;
  /** Healing options; plugins' heal handlers and lint settings are added to them. */
  heal?: DocumentOptions["heal"];
  /** Overrides the engine's compile schedule for this document. */
  schedule?: DocumentOptions["schedule"];
  /**
   * Plugins (PLAN §8.0): their engine files, packages, preambles and fixer
   * modules, heal handlers and lint settings, templates, sanitizer allowances
   * and stylesheets. A key given twice is loaded once, as its last definition;
   * plugins load after their dependencies, which must be among them. Fonts
   * load only from the engine's own plugins (`createEngine`).
   */
  plugins?: readonly TypstreamPlugin[];
  /** More CSS for the HTML target, after the plugins'. */
  stylesheets?: readonly string[];
  /** Fade in new words while streaming (HTML target). Default false. */
  animated?: boolean | AnimateOptions;
  /** Show a caret after the last text while streaming (HTML target). Default false. */
  caret?: boolean;
  /** HTML target: `auto` (default) follows the page's `color-scheme`. */
  theme?: "auto" | "light" | "dark";
  /** `target` of external links; `null` keeps them in the same tab. Default `_blank`. */
  linkTarget?: string | null;
  /** Paged target: selectable text over the pages. Default true. */
  textLayer?: boolean;
  /**
   * Open and compile the document only while the element is near the viewport
   * or the document is streaming. Default true.
   */
  lazy?: boolean;
  /** The document's status changed. */
  onStatusChange?: (status: DocumentStatus, state: DocumentState) => void;
  /** A compile finished with new diagnostics (in input coordinates). */
  onDiagnostics?: (diagnostics: Diagnostic[], state: DocumentState) => void;
  /**
   * An artifact was handed to the renderer: what its compile cost and took
   * (heal patches, fixers, fallback level) and what drawing it cost. For
   * telemetry (PLAN §8.6); the library sends nothing itself.
   */
  onRendered?: (event: RenderedEvent) => void;
  /**
   * A compile's output wasn't the document as it is: the last good render
   * stayed, the tail showed as plain text, or blocks showed as error boxes.
   * The event holds the input and healed source, to collect as a test case.
   */
  onFallback?: (event: FallbackEvent) => void;
  /** A compile ran past the watchdog's budget or crashed the worker. */
  onWatchdog?: (event: WatchdogEvent) => void;
}

/** A document mounted by {@link mountTypstream}. @public */
export interface MountedTypstream {
  /** The element passed to `mountTypstream`. */
  readonly element: HTMLElement;
  /**
   * The engine document; `null` until the element first comes near the
   * viewport (see `lazy`). A new one when the engine, preamble, heal or schedule
   * options change.
   */
  readonly document: EngineDocument | null;
  /** The document's state, `null` before it opens. */
  getState(): DocumentState | null;
  /** Calls `listener` whenever `getState()` changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Applies new options. Anything left out goes back to its default. */
  update(options: TypstreamOptions): void;
  /**
   * Exports the document as PDF (#18), from the engine that compiles the
   * preview. Its inputs are the template's and `inputs`, without fit-width's
   * page size, so it prints at the document's own size. Opens a document that
   * hasn't opened yet (see `lazy`). Rejects with the engine's `ExportError`.
   */
  exportPdf(): Promise<Uint8Array>;
  /**
   * Exports the document as an HTML file that opens on its own
   * ({@link standaloneHtml}), with the mount's plugins, `stylesheets` and `theme`;
   * `options` add to or override them (a `mathFont`, a `title`). Otherwise as
   * {@link MountedTypstream.exportPdf}.
   */
  exportHtml(options?: StandaloneHtmlOptions): Promise<string>;
  /** The source the exports compile (the healed input); opens the document if needed. */
  exportSource(): string;
  /** Disposes the document and removes what was rendered. The engine stays (it isn't ours). */
  destroy(): void;
}

// --- helpers --------------------------------------------------------------------------

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Structural equality for plain options (objects, arrays, primitives), identity
 * for everything else (functions, plugins' bytes): inline objects in props don't
 * reopen the document on every render.
 */
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && equal(a[k], b[k]));
};

/** Within one screen of the viewport, as the paged view draws pages. */
const LAZY_MARGIN = "50%";
/** Wait this long after the element's width last changed before recompiling fit-width pages (ms). */
const RESIZE_DEBOUNCE = 150;

/** How the document is opened: a change to any of these opens a new one. */
interface OpenKey {
  engine: Engine;
  /** The plugins, resolved: the engine applies their facets (preambles before `preamble`). */
  plugins: TypstreamPlugin[];
  preamble: string;
  heal: DocumentOptions["heal"];
  schedule: DocumentOptions["schedule"];
}

/** The template named `o.template`, the last plugin's if two have one by that name. */
const templateOf = (o: TypstreamOptions, plugins = resolvePlugins(o.plugins ?? [])): TemplateSpec | undefined =>
  o.template
    ? plugins
        .flatMap((p) => p.templates ?? [])
        .filter((t) => t.name === o.template)
        .pop()
    : undefined;

const openKey = (o: TypstreamOptions): OpenKey => {
  const plugins = resolvePlugins(o.plugins ?? []);
  const preamble = [
    // Whatever the target, so switching targets doesn't reopen the document: without
    // fit-width's inputs the preamble does nothing.
    o.layout === "fit-width" ? FIT_WIDTH_PREAMBLE : undefined,
    templateOf(o, plugins)?.preamble,
    o.preamble,
  ]
    .filter((p) => p)
    .join("\n");
  return { engine: o.engine, plugins, preamble, heal: o.heal, schedule: o.schedule };
};

const sameKey = (a: OpenKey, b: OpenKey) =>
  a.engine === b.engine &&
  a.preamble === b.preamble &&
  equal(a.plugins, b.plugins) &&
  equal(a.heal, b.heal) &&
  equal(a.schedule, b.schedule);

/** Removed files become `null` deletions; changed ones are sent again. */
const filesDelta = (from: FileDelta, to: FileDelta): FileDelta | null => {
  const delta: FileDelta = {};
  let changed = false;
  for (const path of Object.keys(from)) {
    if (!(path in to)) {
      delta[path] = null;
      changed = true;
    }
  }
  for (const [path, content] of Object.entries(to)) {
    if (from[path] !== content) {
      delta[path] = content;
      changed = true;
    }
  }
  return changed ? delta : null;
};

// --- mount ----------------------------------------------------------------------------

/**
 * Renders a streaming Typst document into `element` and keeps it up to date.
 *
 * @example
 * ```ts
 * const engine = createEngine({ spawn: engineWorker() });
 * const view = mountTypstream(el, { engine, source: "", isStreaming: true });
 * let text = "";
 * for await (const chunk of llmStream) view.update({ engine, source: (text += chunk), isStreaming: true });
 * view.update({ engine, source: text });
 * ```
 * @public
 */
export const mountTypstream = (element: HTMLElement, initial: TypstreamOptions): MountedTypstream => {
  let opts = initial;
  let destroyed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  // The document and what it was last given.
  let doc: EngineDocument | null = null;
  let key: OpenKey | null = null;
  let unsubscribe = () => {};
  let fedText = "";
  let fedFinal = false;
  let fedFiles: FileDelta = {};

  // A `stream` being read: its text so far, and whether it has ended.
  let stream: AsyncIterable<string> | null = null;
  let streamText = "";
  let streamOpen = false;

  // Visibility (lazy) and the element's width (fit-width). An export opens the
  // document whatever its visibility (`exporting`).
  let visible = false;
  let exporting = false;
  let fitInputs: Record<string, string> | null = null;
  let io: IntersectionObserver | null = null;
  let ro: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;

  // Renderers: one per target, created when that target's first artifact arrives.
  let html: { renderer: HtmlRenderer; root: HTMLElement; key: unknown[] } | null = null;
  let paged: { view: PagedView; key: unknown[] } | null = null;
  let shown: { artifact: unknown; caret: boolean } | null = null;

  // What the callbacks were last told, and the latest compile that published an artifact.
  let lastStatus: DocumentStatus | null = null;
  let lastDiagnostics: Diagnostic[] | null = null;
  let lastOk: CompiledEvent | null = null;

  const streaming = () => (opts.stream ? streamOpen : (opts.isStreaming ?? false));

  // --- rendering ---

  const dropHtml = () => {
    if (!html) return;
    html.renderer.dispose();
    html.root.remove();
    html = null;
  };

  const dropPaged = () => {
    paged?.view.destroy();
    paged = null;
  };

  const htmlRenderer = (): HtmlRenderer => {
    const animation = typeof opts.animated === "object" ? opts.animated : undefined;
    const plugins = resolvePlugins(opts.plugins ?? []);
    const want = [opts.theme, animation, plugins, opts.stylesheets, opts.linkTarget];
    if (html && equal(html.key, want)) return html.renderer;
    dropHtml();
    const root = element.ownerDocument.createElement("div");
    element.append(root);
    const renderer = createHtmlRenderer(root, {
      ...(opts.theme ? { theme: opts.theme } : {}),
      ...(animation ? { animation } : {}),
      ...(plugins.length ? { plugins } : {}),
      ...(opts.stylesheets ? { stylesheets: opts.stylesheets } : {}),
      ...(opts.linkTarget !== undefined ? { linkTarget: opts.linkTarget } : {}),
    });
    html = { renderer, root, key: want };
    shown = null;
    return renderer;
  };

  const pagedView = (): PagedView => {
    const want = [opts.layout, opts.linkTarget, opts.textLayer];
    if (paged && equal(paged.key, want)) return paged.view;
    dropPaged();
    const view = createPagedView(element, {
      ...(opts.layout ? { layout: opts.layout } : {}),
      ...(opts.linkTarget !== undefined ? { linkTarget: opts.linkTarget } : {}),
      ...(opts.textLayer !== undefined ? { textLayer: opts.textLayer } : {}),
    });
    paged = { view, key: want };
    shown = null;
    return view;
  };

  /** What to tell `onRendered`: the report of the compile that made the artifact (which came before its state). */
  const rendered = (state: DocumentState, renderMs: number, blocks?: number): RenderedEvent | null => {
    if (!lastOk || lastOk.rev !== state.artifactRev) return null;
    const { type, status, ...report } = lastOk;
    return { ...report, type: "rendered", renderMs, ...(blocks !== undefined ? { blocks } : {}) };
  };

  /** Shows the state's artifact if the renderer doesn't have it yet. Renderers follow the artifact's target. */
  const render = (state: DocumentState) => {
    const { artifact } = state;
    if (!artifact) return;
    if (artifact.target === "html") {
      dropPaged();
      const renderer = htmlRenderer();
      const caret = (opts.caret ?? false) && !state.final;
      if (shown?.artifact === artifact && shown.caret === caret) return;
      shown = { artifact, caret };
      const result = renderer.update(artifact.html, { animate: !!opts.animated && !state.final, caret });
      const event = opts.onRendered && rendered(state, result.ms, result.blocks);
      if (event) opts.onRendered?.(event);
    } else {
      dropHtml();
      const view = pagedView();
      if (shown?.artifact === artifact) return;
      shown = { artifact, caret: false };
      const start = performance.now();
      view.render(artifact);
      const event = opts.onRendered && rendered(state, performance.now() - start);
      if (event) opts.onRendered?.({ ...event, pages: artifact.pageCount });
    }
  };

  const onState = (state: DocumentState) => {
    render(state);
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      opts.onStatusChange?.(state.status, state);
    }
    if (state.diagnostics !== lastDiagnostics) {
      lastDiagnostics = state.diagnostics;
      if (state.lastCompile) opts.onDiagnostics?.(state.diagnostics, state);
    }
    notify();
  };

  const onEvent = (event: DocumentEvent) => {
    if (event.type === "compiled" && event.status === "ok") lastOk = event;
    else if (event.type === "fallback") opts.onFallback?.(event);
    else if (event.type === "watchdog") opts.onWatchdog?.(event);
  };

  // --- the document ---

  const close = () => {
    unsubscribe();
    doc?.dispose();
    doc = null;
    key = null;
  };

  const fitWidth = () => opts.target === "paged" && opts.layout === "fit-width";

  /** The document's inputs without fit-width's page size: what exports compile with. */
  const exportInputs = (): Record<string, string> => ({ ...templateOf(opts)?.inputs, ...opts.inputs });

  const measure = () => {
    const width = element.clientWidth;
    fitInputs = width > 0 ? fitWidthInputs(width, opts.pageHeight ?? "a4") : null;
  };

  const observeWidth = () => {
    if (!fitWidth()) {
      ro?.disconnect();
      ro = null;
      clearTimeout(resizeTimer);
      fitInputs = null;
      return;
    }
    if (ro) return;
    // The first width compiles right away; later ones once resizing pauses.
    // Meanwhile the old pages scale to the new width.
    measure();
    ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        measure();
        sync();
      }, RESIZE_DEBOUNCE);
    });
    ro.observe(element);
  };

  /** Brings the document in line with `opts`, if it should compile now. */
  const sync = () => {
    if (destroyed) return;
    observeWidth();
    const lazy = (opts.lazy ?? true) && typeof IntersectionObserver !== "undefined";
    if (lazy && !io) {
      io = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry || entry.isIntersecting === visible) return;
          visible = entry.isIntersecting;
          sync();
        },
        { rootMargin: LAZY_MARGIN },
      );
      io.observe(element);
    } else if (!lazy && io) {
      io.disconnect();
      io = null;
    }
    // Offscreen and complete: changes wait until it scrolls into view.
    if (lazy && !visible && !streaming() && !exporting) return;

    const target = opts.target ?? "html";
    const inputs = { ...exportInputs(), ...fitInputs };
    const files = opts.files ?? {};
    const text = opts.stream ? streamText : (opts.source ?? "");
    const final = !streaming();

    const want = openKey(opts);
    if (!doc || !key || !sameKey(key, want)) {
      close();
      key = want;
      doc = opts.engine.open({
        target,
        inputs,
        text,
        files,
        ...(want.plugins.length ? { plugins: want.plugins } : {}),
        ...(want.preamble ? { preamble: want.preamble } : {}),
        ...(want.heal ? { heal: want.heal } : {}),
        ...(want.schedule ? { schedule: want.schedule } : {}),
      });
      fedText = text;
      fedFinal = false;
      fedFiles = files;
      lastDiagnostics = null;
      lastOk = null;
      const stopState = doc.subscribe(onState);
      const stopEvents = doc.onEvent(onEvent);
      unsubscribe = () => {
        stopState();
        stopEvents();
      };
    } else {
      doc.setTarget(target);
      doc.setInputs(inputs);
      const delta = filesDelta(fedFiles, files);
      fedFiles = files;
      if (delta) doc.setFiles(delta);
      if (text !== fedText || final !== fedFinal) {
        // A finished document streaming again is a regenerated answer: start over.
        if (fedFinal && !final) doc.reset(text);
        else if (!fedFinal && text.startsWith(fedText)) {
          if (text.length > fedText.length) doc.push(text.slice(fedText.length));
        } else doc.set(text);
        fedText = text;
      }
    }
    if (final && !fedFinal) doc.finish();
    fedFinal = final;
    onState(doc.getState());
  };

  const read = async (source: AsyncIterable<string>) => {
    const iterator = source[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await iterator.next();
        if (stream !== source || destroyed) {
          await iterator.return?.();
          return;
        }
        if (next.done) break;
        streamText += next.value;
        sync();
      }
    } catch (error) {
      // The stream failed: show what arrived, complete, and let the app hear of it.
      if (stream === source && !destroyed) globalThis.reportError?.(error);
    }
    if (stream !== source || destroyed) return;
    streamOpen = false;
    sync();
  };

  const apply = (next: TypstreamOptions) => {
    opts = next;
    const nextStream = next.stream ?? null;
    if (nextStream !== stream) {
      stream = nextStream;
      streamText = "";
      streamOpen = nextStream !== null;
      if (nextStream) void read(nextStream);
    }
    sync();
  };

  apply(initial);

  /** The document for an export, opened now if it hasn't been. */
  const exportDoc = (): EngineDocument => {
    if (destroyed) throw new Error("mountTypstream: the mount is destroyed");
    if (!doc) {
      exporting = true;
      sync();
    }
    if (!doc) throw new Error("mountTypstream: the document didn't open");
    return doc;
  };

  return {
    element,
    get document() {
      return doc;
    },
    getState: () => doc?.getState() ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next) {
      if (!destroyed) apply(next);
    },
    exportPdf: async () => exportDoc().exportPdf({ inputs: exportInputs() }),
    async exportHtml(options = {}) {
      const html = await exportDoc().exportHtml({ inputs: exportInputs() });
      return standaloneHtml(html, {
        ...(opts.theme ? { theme: opts.theme } : {}),
        ...options,
        plugins: resolvePlugins([...(opts.plugins ?? []), ...(options.plugins ?? [])]),
        stylesheets: [...(opts.stylesheets ?? []), ...(options.stylesheets ?? [])],
      });
    },
    exportSource: () => exportDoc().exportSource(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stream = null;
      io?.disconnect();
      ro?.disconnect();
      clearTimeout(resizeTimer);
      close();
      dropHtml();
      dropPaged();
      listeners.clear();
    },
  };
};
