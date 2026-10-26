// The engine server: the worker half of the protocol in @typstream/core
// (PLAN §6.1). It keeps each document's text, preamble, files and inputs, hands
// them to an EngineAdapter, and turns compiles into the notifications and
// responses the client expects. Requests run one at a time, in arrival order;
// `$/cancel` drops one that hasn't started.

import {
  applyEdit,
  type ClientCapabilities,
  type ClientMessage,
  type CompileParams,
  type CompileResult,
  type Diagnostic,
  type DocumentUri,
  type ExportParams,
  type ExportResult,
  type FileContent,
  type FileDelta,
  type InitializeParams,
  type InitializeResult,
  isClientNotification,
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
import type { AdapterDocument, EngineAdapter } from "./adapter";

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
  /** Key of the `sys.inputs` last set. */
  inputs: string | null;
  /** Revision of the last paged artifact sent, which the adapter's changed pages diff against; `null` after HTML. */
  pagedBase: Revision | null;
}

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

class Server implements EngineServer {
  private phase: "new" | "initializing" | "ready" | "shutdown" = "new";
  private client: ClientCapabilities = {};
  private readonly docs = new Map<DocumentUri, Doc>();
  private chain: Promise<void> = Promise.resolve();
  /** Requests received and not yet started; only these can be cancelled. */
  private readonly waiting = new Set<RequestId>();
  private readonly cancelled = new Set<RequestId>();

  constructor(
    private readonly adapter: EngineAdapter,
    private readonly post: (message: ServerMessage) => void,
    private readonly options: ServerOptions,
  ) {}

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
      const handler = this.handlers[request.method] as (params: unknown, received: number) => Promise<unknown>;
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

  /** Brings the compiler's `/main.typ` and `sys.inputs` up to date. */
  private sync(doc: Doc, inputs: Record<string, string> | undefined): void {
    const key = inputsKey(inputs);
    if (key !== doc.inputs) {
      try {
        doc.compiler.setInputs(inputs ?? {});
      } catch (e) {
        throw invalid(e instanceof Error ? e.message : String(e));
      }
      doc.inputs = key;
    }
    if (doc.dirty) {
      doc.compiler.setFiles({ [MAIN]: doc.prefix + doc.text });
      doc.dirty = false;
    }
  }

  private diagnostics(doc: Doc, ds: Diagnostic[]): Diagnostic[] {
    return ds.map((d) => fromMain(d, doc.prefix.length));
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
        await this.adapter.init(params.options ?? {});
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
      const doc = this.current(uri, rev);
      if (!this.adapter.targets.includes(target)) this.unsupported(`the ${target} target`);
      this.sync(doc, params.inputs);
      let ok: boolean;
      let compileMs: number | undefined;
      let exportMs: number | undefined;
      if (target === "html") {
        const r = await doc.compiler.compileHtml();
        ({ compileMs, exportMs } = r);
        this.post({
          method: "document/diagnostics",
          params: { uri, rev, target, diagnostics: this.diagnostics(doc, r.diagnostics) },
        });
        ok = r.html !== null;
        if (r.html !== null) {
          this.post({ method: "document/artifact", params: { uri, rev, artifact: { target, html: r.html } } });
          doc.pagedBase = null;
        }
      } else {
        // Changed pages only when the client can apply them to the pages it has.
        const full = params.fullPages === true || !this.client.pagedDiff || doc.pagedBase === null;
        const r = await doc.compiler.compilePaged({ fullPages: full });
        ({ compileMs, exportMs } = r);
        this.post({
          method: "document/diagnostics",
          params: { uri, rev, target, diagnostics: this.diagnostics(doc, r.diagnostics) },
        });
        ok = r.output !== null;
        if (r.output) {
          const { pageCount, changed } = r.output;
          this.post({
            method: "document/artifact",
            params: { uri, rev, artifact: { target, base: full ? null : doc.pagedBase, pageCount, pages: changed } },
          });
          doc.pagedBase = rev;
        }
      }
      const result: CompileResult = {
        uri,
        rev,
        target,
        status: ok ? "ok" : "error",
        timings: { totalMs: performance.now() - received },
      };
      if (compileMs !== undefined) result.timings.compileMs = compileMs;
      if (exportMs !== undefined) result.timings.exportMs = exportMs;
      const memoryBytes = this.adapter.memoryBytes?.();
      if (memoryBytes !== undefined) result.memoryBytes = memoryBytes;
      return result;
    },

    "export/html": async ({ uri, rev, inputs }: ExportParams): Promise<ExportResult<string>> => {
      const doc = this.current(uri, rev);
      if (!this.adapter.exports.includes("html")) this.unsupported("HTML export");
      this.sync(doc, inputs);
      const r = await doc.compiler.compileHtml();
      const diagnostics = this.diagnostics(doc, r.diagnostics);
      return r.html === null
        ? { uri, rev, diagnostics, status: "error" }
        : { uri, rev, diagnostics, status: "ok", data: r.html };
    },

    "export/pdf": async ({ uri, rev, inputs }: ExportParams): Promise<ExportResult<Uint8Array>> => {
      const doc = this.current(uri, rev);
      if (!this.adapter.exports.includes("pdf") || !doc.compiler.exportPdf) this.unsupported("PDF export");
      this.sync(doc, inputs);
      const r = await doc.compiler.exportPdf();
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
