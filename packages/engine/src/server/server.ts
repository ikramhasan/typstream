// The engine server: the worker half of the protocol in @typstream/core
// (PLAN §6.1). It keeps each document's text, preamble, files and inputs, hands
// them to an EngineAdapter, and turns compiles into the notifications and
// responses the client expects. Requests run one at a time, in arrival order;
// `$/cancel` drops one that hasn't started.

import {
  applyEdit,
  type ClientCapabilities,
  type ClientMessage,
  type CompileMode,
  type CompileParams,
  type CompileResult,
  type CompileTarget,
  type Diagnostic,
  type DiagnosticFixer,
  type DocumentUri,
  type ExportParams,
  type ExportResult,
  type FileContent,
  type FileDelta,
  type InitializeParams,
  type InitializeResult,
  isClientNotification,
  isError,
  mapDiagnostic,
  type ParamsOf,
  PROTOCOL_VERSION,
  ProtocolError,
  type Range,
  type Request,
  type RequestId,
  type RequestMethod,
  type ResultOf,
  type Revision,
  type ServerMessage,
  type VersionMismatchData,
} from "@typstream/core";
import type { AdapterDocument, AdapterHtmlResult, AdapterPagedResult, EngineAdapter } from "./adapter";
import { type Anchored, Anchors, fromAnchored } from "./anchors";
import { DEFAULT_FIXERS, FIX_BUDGET_MS, fixersOf, orderFixers, runFixers } from "./fixers";
import { RUNTIME, RUNTIME_IMPORT, RUNTIME_PATH } from "./runtime";

/**
 * `Diagnostic.file.path` of problems inside a document's preamble. The preamble
 * isn't a file the document can import; it's evaluated in front of it.
 * @public
 */
export const PREAMBLE_PATH = "<preamble>";

const MAIN = "/main.typ";

/**
 * Hooks for the host the server runs in.
 * @public
 */
export interface ServerOptions {
  /**
   * The compiler failed in a way that may have left it unusable: a wasm trap
   * (a panic in Typst, or out of memory). The request stays unanswered and the
   * server stops; the host should end so the client replaces it ({@link serve}
   * rethrows the error in the worker). Without this hook the request is
   * answered `internal`.
   */
  onFatal?(error: unknown): void;
  /**
   * Layer 3 diagnostic fixers (PLAN §5.5), tried by priority. Default
   * {@link DEFAULT_FIXERS}; `[]` turns them off. Fixers from `initialize`'s
   * `fixerModules` join these.
   */
  fixers?: readonly DiagnosticFixer[];
}

/**
 * The server end of one client connection.
 * @public
 */
export interface EngineServer {
  /** A message from the client. Answers go to the `post` function the server was created with. */
  receive(message: ClientMessage): void;
}

/**
 * Creates a server that compiles with `adapter` and answers through `post`.
 * Use {@link serve} in a worker; this is for other transports (tests, a socket).
 * @public
 */
export const createServer = (
  adapter: EngineAdapter,
  post: (message: ServerMessage) => void,
  options: ServerOptions = {},
): EngineServer => new Server(adapter, post, options);

interface Doc {
  rev: Revision;
  text: string;
  /** The preamble and a newline, or empty: `/main.typ` is `prefix + text`. */
  prefix: string;
  compiler: AdapterDocument;
  /** `text` changed since `/main.typ` was last written. */
  dirty: boolean;
  /** Source anchors for HTML compiles (PLAN §10.2), of `text` and of texts the fixers changed. */
  anchors: Anchors;
  fixedAnchors: Anchors;
  /** The anchors `/main.typ` was last written with, or `null` when it has none. */
  anchored: Anchored | null;
  /** Length of what precedes the text in `/main.typ`: `prefix`, plus the runtime import in fixed compiles. */
  offset: number;
  /** Key of the `sys.inputs` last set. */
  inputs: string | null;
  /** Revision of the last paged artifact sent, which the adapter's changed pages diff against; `null` after HTML. */
  pagedBase: Revision | null;
}

/** An adapter compile's result, its diagnostics moved into document coordinates. */
type Compiled = AdapterHtmlResult | AdapterPagedResult;

type Handlers = { [M in RequestMethod]: (params: ParamsOf<M>, received: number) => Promise<ResultOf<M>> };

const invalid = (message: string) => new ProtocolError("invalid-params", message);

// Looked up at runtime, so the package needs no WebAssembly type declarations.
const RuntimeError = (globalThis as { WebAssembly?: { RuntimeError: abstract new () => Error } }).WebAssembly
  ?.RuntimeError;

/** A wasm trap: Typst panicked (or ran out of memory) and the instance may be corrupt. */
const isTrap = (e: unknown): boolean => RuntimeError !== undefined && e instanceof RuntimeError;

const inputsKey = (inputs: Record<string, string> | undefined): string =>
  JSON.stringify(Object.entries(inputs ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Moves a diagnostic from `/main.typ` (preamble + document) into document
 * coordinates. Problems inside the preamble report it as their `file`, with the
 * nearest call site in the document (from the trace) as `span`, the way
 * engine-wasm reports problems in other files.
 */
export const fromMain = (d: Diagnostic, offset: number): Diagnostic => {
  if (offset === 0) return d;
  const inDocument = (r: Range | null): Range | null =>
    r && r.from >= offset ? { from: r.from - offset, to: r.to - offset } : null;
  const trace = d.trace.map((t) => ({ ...t, span: inDocument(t.span) }));
  const span = inDocument(d.span);
  if (d.span && !span) {
    const callSite = trace.find((t) => t.span)?.span ?? null;
    return { ...d, span: callSite, trace, file: d.file ?? { path: PREAMBLE_PATH, span: d.span } };
  }
  return { ...d, span, trace };
};

/** A protocol file path (relative to the document root) as the adapter's absolute virtual path. */
const virtualPath = (path: string): string => {
  const rel = path.replace(/^(\.?\/)+/, "");
  if (rel === "" || rel === "main.typ") throw invalid(`can't write ${JSON.stringify(path)}: it is the document`);
  return `/${rel}`;
};

/** Imports a fixer module (PLAN §8.2); its default export is a fixer or an array of them. */
const loadFixers = async (url: string): Promise<DiagnosticFixer[]> => {
  let module: { default?: unknown };
  try {
    module = await import(/* @vite-ignore */ url);
  } catch (e) {
    throw invalid(`fixer module ${url} failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return fixersOf(module.default, url);
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }
};

class Server implements EngineServer {
  private phase: "new" | "initializing" | "ready" | "shutdown" = "new";
  private client: ClientCapabilities = {};
  private readonly docs = new Map<DocumentUri, Doc>();
  private chain: Promise<void> = Promise.resolve();
  /** Requests received and not yet started; only these can be cancelled. */
  private readonly waiting = new Set<RequestId>();
  private readonly cancelled = new Set<RequestId>();
  /** Layer 3 fixers in the order they're tried; plugin modules join at `initialize`. */
  private fixers: DiagnosticFixer[];

  constructor(
    private readonly adapter: EngineAdapter,
    private readonly post: (message: ServerMessage) => void,
    private readonly options: ServerOptions,
  ) {
    this.fixers = orderFixers(options.fixers ?? DEFAULT_FIXERS);
  }

  receive(message: ClientMessage): void {
    if (isClientNotification(message)) {
      if (message.method === "$/cancel" && this.waiting.has(message.params.id)) this.cancelled.add(message.params.id);
      return;
    }
    const received = performance.now();
    this.waiting.add(message.id);
    this.chain = this.chain.then(() => this.handle(message, received));
  }

  private async handle(request: Request, received: number): Promise<void> {
    const { id } = request;
    this.waiting.delete(id);
    try {
      if (this.cancelled.delete(id)) throw new ProtocolError("request-cancelled", "cancelled before it started");
      const handler = this.handlers[request.method] as
        | ((params: unknown, received: number) => Promise<unknown>)
        | undefined;
      if (!handler) throw new ProtocolError("method-not-found", `unknown method ${String(request.method)}`);
      const result = await handler(request.params, received);
      this.post({ id, result } as ServerMessage);
    } catch (e) {
      if (e instanceof ProtocolError) {
        this.post({ id, error: e.toJSON() });
        return;
      }
      // A trap may have left the wasm instance corrupt. In a worker, die without
      // answering: the client sees a crash (a watchdog strike, PLAN §6.3) and
      // replaces the worker.
      if (isTrap(e) && this.options.onFatal) {
        this.phase = "shutdown";
        this.options.onFatal(e);
        return;
      }
      this.post({ id, error: { code: "internal", message: e instanceof Error ? e.message : String(e) } });
    }
  }

  private ready(): void {
    if (this.phase !== "ready") throw new ProtocolError("not-initialized", `the server is ${this.phase}`);
  }

  private doc(uri: DocumentUri): Doc {
    this.ready();
    const doc = this.docs.get(uri);
    if (!doc) throw new ProtocolError("document-not-open", `document ${uri} is not open`);
    return doc;
  }

  /** The document, if `rev` is its current revision (compile, export). */
  private current(uri: DocumentUri, rev: Revision): Doc {
    const doc = this.doc(uri);
    if (rev !== doc.rev)
      throw new ProtocolError("content-modified", `document ${uri} is at revision ${doc.rev}, not ${rev}`);
    return doc;
  }

  /** The document, if `rev` is a new revision for it (edits). */
  private next(uri: DocumentUri, rev: Revision): Doc {
    const doc = this.doc(uri);
    if (!(rev > doc.rev))
      throw new ProtocolError("stale-revision", `document ${uri} is already at revision ${doc.rev}`);
    return doc;
  }

  private writeFiles(compiler: AdapterDocument, files: FileDelta): void {
    const delta: Record<string, FileContent | null> = {};
    for (const [path, content] of Object.entries(files)) delta[virtualPath(path)] = content;
    try {
      compiler.setFiles(delta);
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Brings the compiler's `/main.typ` and `sys.inputs` up to date. With
   * `anchors`, `/main.typ` holds the document with source anchors (HTML
   * previews only; paged output and exports never have them).
   */
  private sync(doc: Doc, inputs: Record<string, string> | undefined, anchors = false): void {
    const key = inputsKey(inputs);
    if (key !== doc.inputs) {
      try {
        doc.compiler.setInputs(inputs ?? {});
      } catch (e) {
        throw invalid(e instanceof Error ? e.message : String(e));
      }
      doc.inputs = key;
    }
    if (doc.dirty || anchors !== (doc.anchored !== null)) {
      doc.anchored = anchors ? doc.anchors.apply(doc.text) : null;
      doc.compiler.setFiles({ [MAIN]: doc.prefix + (doc.anchored?.text ?? doc.text) });
      doc.offset = doc.prefix.length;
      doc.dirty = false;
    }
  }

  /**
   * Writes a text the fixers changed as `/main.typ`, after the preamble and the
   * runtime library's import. Anchors name offsets in the client's text
   * (`toOriginal`). The next `sync` writes the document's own text again.
   */
  private writeFixed(doc: Doc, text: string, anchors: boolean, toOriginal: (pos: number) => number): void {
    doc.anchored = anchors ? doc.fixedAnchors.apply(text, toOriginal) : null;
    const prefix = doc.prefix + RUNTIME_IMPORT;
    doc.compiler.setFiles({ [MAIN]: prefix + (doc.anchored?.text ?? text) });
    doc.offset = prefix.length;
    doc.dirty = true;
  }

  /** Diagnostics from `/main.typ` in the coordinates of the text last written to it. */
  private diagnostics(doc: Doc, ds: Diagnostic[]): Diagnostic[] {
    const { anchored } = doc;
    return ds.map((d) => {
      const inDocument = fromMain(d, doc.offset);
      return anchored ? mapDiagnostic(inDocument, (pos) => fromAnchored(anchored, pos)) : inDocument;
    });
  }

  /** One compile of what `/main.typ` holds, with diagnostics in its text's coordinates. */
  private async compileMain(doc: Doc, target: CompileTarget, mode: CompileMode, fullPages: boolean): Promise<Compiled> {
    const r =
      target === "html"
        ? await doc.compiler.compileHtml({ mode })
        : await doc.compiler.compilePaged({ fullPages, mode });
    return { ...r, diagnostics: this.diagnostics(doc, r.diagnostics) };
  }

  private unsupported(what: string): never {
    throw new ProtocolError("unsupported", `${this.adapter.info.name} doesn't support ${what}`);
  }

  private readonly handlers: Handlers = {
    initialize: async (params: InitializeParams): Promise<InitializeResult> => {
      if (this.phase !== "new") throw invalid(`the server is ${this.phase}; initialize only once`);
      if (params.protocolVersion !== PROTOCOL_VERSION) {
        const data: VersionMismatchData = { supported: [PROTOCOL_VERSION] };
        throw new ProtocolError(
          "protocol-version-mismatch",
          `server speaks protocol ${PROTOCOL_VERSION}, client ${params.protocolVersion}`,
          data,
        );
      }
      this.phase = "initializing";
      try {
        const [, modules] = await Promise.all([
          this.adapter.init(params.options ?? {}),
          Promise.all((params.options?.fixerModules ?? []).map(loadFixers)),
        ]);
        this.fixers = orderFixers([...(this.options.fixers ?? DEFAULT_FIXERS), ...modules.flat()]);
      } catch (e) {
        this.phase = "new";
        throw e;
      }
      this.client = params.capabilities ?? {};
      this.phase = "ready";
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          targets: [...this.adapter.targets],
          exports: [...this.adapter.exports],
          pagedDiff: this.adapter.targets.includes("paged"),
        },
        serverInfo: { ...this.adapter.info },
      };
    },

    shutdown: async () => {
      this.ready();
      for (const doc of this.docs.values()) doc.compiler.close();
      this.docs.clear();
      this.phase = "shutdown";
      return null;
    },

    "document/open": async ({ uri, rev, text, preamble, files }) => {
      this.ready();
      if (this.docs.has(uri)) throw new ProtocolError("document-already-open", `document ${uri} is already open`);
      const compiler = this.adapter.open();
      try {
        // Before the document's files, so one at the same path replaces it.
        compiler.setFiles({ [RUNTIME_PATH]: RUNTIME });
        if (files) this.writeFiles(compiler, files);
      } catch (e) {
        compiler.close();
        throw e;
      }
      this.docs.set(uri, {
        rev,
        text,
        prefix: preamble ? `${preamble}\n` : "",
        compiler,
        dirty: true,
        anchors: new Anchors(),
        fixedAnchors: new Anchors(),
        anchored: null,
        offset: 0,
        inputs: null,
        pagedBase: null,
      });
      return null;
    },

    "document/edit": async ({ uri, rev, edits }) => {
      const doc = this.next(uri, rev);
      let text = doc.text;
      for (const edit of edits) {
        const { from, to } = edit;
        if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= to && to <= text.length)) {
          throw invalid(`edit [${from}, ${to}) is outside the text (length ${text.length})`);
        }
        text = applyEdit(text, edit);
        doc.anchors.changed(from);
      }
      doc.text = text;
      doc.rev = rev;
      doc.dirty = true;
      return null;
    },

    "document/setFiles": async ({ uri, rev, files }) => {
      const doc = this.next(uri, rev);
      this.writeFiles(doc.compiler, files);
      doc.rev = rev;
      return null;
    },

    "document/close": async ({ uri }) => {
      this.doc(uri).compiler.close();
      this.docs.delete(uri);
      return null;
    },

    compile: async (params: CompileParams, received): Promise<CompileResult> => {
      const { uri, rev, target } = params;
      const mode = params.mode ?? "streaming";
      const doc = this.current(uri, rev);
      if (!this.adapter.targets.includes(target)) this.unsupported(`the ${target} target`);
      const anchors = target === "html" && params.anchors !== false;
      this.sync(doc, params.inputs, anchors);
      // Changed pages only when the client can apply them to the pages it has.
      const full = params.fullPages === true || !this.client.pagedDiff || doc.pagedBase === null;
      let r = await this.compileMain(doc, target, mode, full);
      let { compileMs, diagnostics } = r;
      let fixMs: number | undefined;
      if (r.diagnostics.some(isError) && this.fixers.length > 0) {
        const fixStart = performance.now();
        const { settled } = params;
        const outcome = await runFixers({
          text: doc.text,
          settled:
            mode === "streaming" && settled !== undefined
              ? Math.max(0, Math.min(settled, doc.text.length))
              : doc.text.length,
          mode,
          fixers: this.fixers,
          diagnostics,
          deadline: received + FIX_BUDGET_MS[mode],
          compile: async (text, toOriginal) => {
            this.writeFixed(doc, text, anchors, toOriginal);
            r = await this.compileMain(doc, target, mode, full);
            if (r.compileMs !== undefined) compileMs = (compileMs ?? 0) + r.compileMs;
            return r.diagnostics;
          },
        });
        diagnostics = outcome.diagnostics;
        if (outcome.rounds > 0) fixMs = performance.now() - fixStart;
      }
      this.post({ method: "document/diagnostics", params: { uri, rev, target, diagnostics } });
      // The last compile's output: the first one's, or the fixed text's.
      const ok = "html" in r ? r.html !== null : r.output !== null;
      if ("html" in r && r.html !== null) {
        this.post({ method: "document/artifact", params: { uri, rev, artifact: { target: "html", html: r.html } } });
        doc.pagedBase = null;
      } else if ("output" in r && r.output) {
        const { pageCount, changed } = r.output;
        this.post({
          method: "document/artifact",
          params: {
            uri,
            rev,
            artifact: { target: "paged", base: full ? null : doc.pagedBase, pageCount, pages: changed },
          },
        });
        doc.pagedBase = rev;
      }
      const result: CompileResult = {
        uri,
        rev,
        target,
        status: ok ? "ok" : "error",
        timings: { totalMs: performance.now() - received },
      };
      if (compileMs !== undefined) result.timings.compileMs = compileMs;
      if (r.exportMs !== undefined) result.timings.exportMs = r.exportMs;
      if (fixMs !== undefined) result.timings.fixMs = fixMs;
      const memoryBytes = this.adapter.memoryBytes?.();
      if (memoryBytes !== undefined) result.memoryBytes = memoryBytes;
      return result;
    },

    "export/html": async ({ uri, rev, inputs }: ExportParams): Promise<ExportResult<string>> => {
      const doc = this.current(uri, rev);
      if (!this.adapter.exports.includes("html")) this.unsupported("HTML export");
      this.sync(doc, inputs);
      const r = await doc.compiler.compileHtml({ mode: "final" });
      const diagnostics = this.diagnostics(doc, r.diagnostics);
      return r.html === null
        ? { uri, rev, diagnostics, status: "error" }
        : { uri, rev, diagnostics, status: "ok", data: r.html };
    },

    "export/pdf": async ({ uri, rev, inputs }: ExportParams): Promise<ExportResult<Uint8Array>> => {
      const doc = this.current(uri, rev);
      if (!this.adapter.exports.includes("pdf") || !doc.compiler.exportPdf) this.unsupported("PDF export");
      this.sync(doc, inputs);
      const r = await doc.compiler.exportPdf({ mode: "final" });
      const diagnostics = this.diagnostics(doc, r.diagnostics);
      return r.pdf === null
        ? { uri, rev, diagnostics, status: "error" }
        : { uri, rev, diagnostics, status: "ok", data: r.pdf };
    },

    "resolve/span": async ({ uri, rev }) => {
      this.current(uri, rev);
      return this.unsupported("resolve/span");
    },

    "resolve/location": async ({ uri, rev }) => {
      this.current(uri, rev);
      return this.unsupported("resolve/location");
    },
  };
}
