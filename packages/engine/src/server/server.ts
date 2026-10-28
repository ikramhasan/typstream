// The engine server: the worker half of the protocol in @typstream/core
// (PLAN §6.1). It keeps each document's text, preamble, files and inputs, hands
// them to an EngineAdapter, and turns compiles into the notifications and
// responses the client expects. Requests run one at a time, in arrival order;
// `$/cancel` drops one that hasn't started.

import {
  type AppliedFix,
  applyEdit,
  type ClientCapabilities,
  type ClientMessage,
  type CompileFallback,
  type CompileMode,
  type CompileParams,
  type CompileResult,
  type CompileTarget,
  type Diagnostic,
  type DiagnosticFixer,
  type DocumentUri,
  type ExportParams,
  type ExportResult,
  type FallbackParams,
  type FileContent,
  type FileDelta,
  type FontCatalogue,
  type InitializeParams,
  type InitializeResult,
  isClientNotification,
  isError,
  mapDiagnostic,
  type PageFormat,
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
  type SkippedRange,
  type VersionMismatchData,
} from "@typstream/core";
import { fileKey } from "../image-paths";
import type {
  AdapterCompileResult,
  AdapterDocument,
  AdapterHtmlResult,
  AdapterPagedResult,
  EngineAdapter,
} from "./adapter";
import { type Anchored, Anchors, fromAnchored } from "./anchors";
import { type Attempt, type RecoverMemo, recover, showsLess, toDocument, type Variant } from "./fallback";
import {
  applyEdits,
  DEFAULT_FIXERS,
  FIX_BUDGET_MS,
  fixersOf,
  missingImage,
  orderFixers,
  placeholderImages,
  runFixers,
} from "./fixers";
import { anyArrives, type FontCatalogueOptions, FontCatalogues } from "./fonts";
import { DocumentPackages, type PackageOptions, PackageStore } from "./packages";
import { RUNTIME, RUNTIME_IMPORT, RUNTIME_PATH } from "./runtime";

/**
 * `Diagnostic.file.path` of problems inside a document's preamble. The preamble
 * isn't a file the document can import; it's evaluated in front of it.
 * @public
 */
export const PREAMBLE_PATH = "<preamble>";

const MAIN = "/main.typ";

/** How long an export waits for fonts its compile lacked (they are on their way) before exporting without them. */
const EXPORT_WAIT_MS = 3000;

/** Whether `pending` settles within `ms`: `true` if it resolved. */
const arrives = (pending: Promise<void>, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    pending.then(
      () => resolve(true),
      () => resolve(false),
    );
    pending.finally(() => clearTimeout(timer)).catch(() => {});
  });

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
   * and `document/open`'s `fixerModules` join these.
   */
  fixers?: readonly DiagnosticFixer[];
  /**
   * Import the fixer modules the client names (`initialize`'s and
   * `document/open`'s `fixerModules`). Default true, for a worker serving its
   * own page. Importing a module runs its code, so a server facing untrusted
   * clients must set false (`@typstream/node` does): their lists are then
   * ignored, with a warning.
   */
  clientFixers?: boolean;
  /**
   * Typst packages (PLAN §6.4): the server's own allowlist, whether to take the
   * client's, where packages without a URL come from. Default: only what the
   * client allows. @beta
   */
  packages?: PackageOptions;
  /**
   * Font catalogues (PLAN §6.4): the server's own, whether to use the
   * client's. Default: only the client's. @beta
   */
  fontCatalogues?: FontCatalogueOptions;
}

/**
 * The fallback (Layer 4, PLAN §5.6) starts a compile only while the request
 * has taken less than this (ms): half the client's watchdog budgets (3 s
 * streaming, 10 s final, by default), so it can't run them out on its own.
 */
export const FALLBACK_BUDGET_MS: Readonly<Record<CompileMode, number>> = { streaming: 1500, final: 5000 };

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
  /** The `pageFormat` of the pages since `pagedBase`. */
  pageFormat: PageFormat;
  /** What the fallback learnt about the text; forgotten when files or inputs change. */
  memo: RecoverMemo | null;
  /** The text the last artifact compiled, unless it showed the tail as plain text (fallback level 1, #65). */
  shown: { target: CompileTarget; text: string } | null;
  /** Packages it may import, and those mounted in `compiler`. */
  packages: DocumentPackages;
  /** The `fileKey`s of the files the client wrote: images without one show as placeholders. */
  files: Set<string>;
  /** Layer 3 fixers in the order they're tried: the server's, plus the document's fixer modules'. */
  fixers: DiagnosticFixer[];
  /** Font catalogues it loads families it names from: the server's, `initialize`'s and its own. */
  catalogues: FontCatalogue[];
  /**
   * What the last compile lacked and is on its way (a lazy font, a catalogue's family), with that
   * compile's params to repeat once it arrives. Any compile replaces it.
   */
  waiting: { pending: Promise<void>; params: CompileParams } | null;
}

/** An adapter compile's result, its diagnostics moved into document coordinates. */
type Compiled = AdapterHtmlResult | AdapterPagedResult;

type Handlers = { [M in RequestMethod]: (params: ParamsOf<M>, received: number) => Promise<ResultOf<M>> };

const invalid = (message: string) => new ProtocolError("invalid-params", message);

// Looked up at runtime, so the package needs no WebAssembly type declarations.
const RuntimeError = (globalThis as { WebAssembly?: { RuntimeError: abstract new () => Error } }).WebAssembly
  ?.RuntimeError;

/**
 * A wasm trap: Typst panicked (or ran out of memory) and the instance may be
 * corrupt. Running out of the host's call stack inside wasm (content nested
 * 100,000 deep, #29) throws the engine's stack overflow error instead,
 * `RangeError` (V8, JavaScriptCore) or `InternalError` (SpiderMonkey). It
 * unwinds Rust frames without running their cleanup and leaves the shadow
 * stack pointer where it was, so it is fatal too.
 */
const isTrap = (e: unknown): boolean =>
  (RuntimeError !== undefined && e instanceof RuntimeError) ||
  e instanceof RangeError ||
  (e instanceof Error && e.name === "InternalError");

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

/** A file of a package: `@namespace/name:x.y.z/` and a path inside it (engine-wasm's convention). */
const PACKAGE_FILE = /^@[^/]+\/[^/:]+:\d+\.\d+\.\d+\/./;

/**
 * A protocol file path (relative to the document root) as the adapter's
 * absolute virtual path. Package files keep their spec prefix.
 */
const virtualPath = (path: string): string => {
  if (PACKAGE_FILE.test(path)) return path;
  const rel = path.replace(/^(\.?\/)+/, "");
  if (rel === "" || rel === "main.typ") throw invalid(`can't write ${JSON.stringify(path)}: it is the document`);
  return `/${rel}`;
};

/** Checked fallback params; `skip` must be ascending, disjoint ranges of the text. */
const fallbackOf = (f: FallbackParams | undefined, length: number): FallbackParams | null => {
  if (f === undefined || f === null) return null;
  if (typeof f !== "object") throw invalid("fallback must be an object");
  const skip: SkippedRange[] = [];
  for (const r of f.skip ?? []) {
    const { from, to, reason } = r ?? ({} as SkippedRange);
    if (
      !(
        Number.isInteger(from) &&
        Number.isInteger(to) &&
        from >= (skip.at(-1)?.to ?? 0) &&
        from < to &&
        to <= length
      ) ||
      (reason !== "timeout" && reason !== "crash")
    ) {
      throw invalid(`fallback.skip: [${from}, ${to}) must be inside the text (length ${length}), ascending, disjoint`);
    }
    skip.push({ from, to, reason });
  }
  return { isolate: f.isolate === true, stablePrefix: f.stablePrefix === true, skip };
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
  /** Fixer modules loaded at `initialize`, which documents already have. */
  private sharedModules = new Set<string>();
  /** Documents' fixer modules by URL, each imported once. */
  private readonly documentModules = new Map<string, Promise<DiagnosticFixer[]>>();
  private readonly packages: PackageStore;
  private readonly fonts: FontCatalogues;

  constructor(
    private readonly adapter: EngineAdapter,
    private readonly post: (message: ServerMessage) => void,
    private readonly options: ServerOptions,
  ) {
    this.fixers = orderFixers(options.fixers ?? DEFAULT_FIXERS);
    this.packages = new PackageStore(options.packages);
    this.fonts = new FontCatalogues(
      adapter,
      (family) => this.post({ method: "fonts/loaded", params: family }),
      (message) => this.post({ method: "$/log", params: { level: "warn", message } }),
      options.fontCatalogues,
    );
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

  /** Writes a document's files, and records which it has in `keys` (`fileKey`s; packages' files aren't). */
  private writeFiles(compiler: AdapterDocument, files: FileDelta, keys: Set<string>): void {
    const delta: Record<string, FileContent | null> = {};
    for (const [path, content] of Object.entries(files)) delta[virtualPath(path)] = content;
    try {
      compiler.setFiles(delta);
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : String(e));
    }
    for (const [path, content] of Object.entries(files)) {
      const key = PACKAGE_FILE.test(path) ? null : fileKey(path);
      if (key === null) continue;
      if (content === null) keys.delete(key);
      else keys.add(key);
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
      doc.memo = null;
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
      const inDocument = doc.packages.describe(fromMain(d, doc.offset));
      return anchored ? mapDiagnostic(inDocument, (pos) => fromAnchored(anchored, pos)) : inDocument;
    });
  }

  /** One compile of what `/main.typ` holds, with diagnostics in its text's coordinates. */
  private async compileMain(
    doc: Doc,
    target: CompileTarget,
    mode: CompileMode,
    fullPages: boolean,
    drawings: boolean,
  ): Promise<Compiled> {
    const r =
      target === "html"
        ? await doc.compiler.compileHtml({ mode })
        : await doc.compiler.compilePaged({ fullPages, drawings, mode });
    return { ...r, diagnostics: this.diagnostics(doc, r.diagnostics) };
  }

  /**
   * Compiles a document's revision again once `loading` packages arrive, unless
   * a newer revision came first: server-initiated output, which the client
   * takes as the later artifact of that revision.
   */
  private recompile(loading: Promise<void>, params: CompileParams): void {
    void loading.then(() => {
      this.chain = this.chain.then(async () => {
        if (this.phase !== "ready" || this.docs.get(params.uri)?.rev !== params.rev) return;
        try {
          await this.handlers.compile(params, performance.now());
        } catch (e) {
          if (isTrap(e) && this.options.onFatal) {
            this.phase = "shutdown";
            this.options.onFatal(e);
          }
        }
      });
    });
  }

  /**
   * Remembers what a compile lacked (replacing what an earlier one did), and
   * once it has arrived queues a recompile like a request, so it never runs
   * alongside one.
   */
  private await(doc: Doc, params: CompileParams, pending: Promise<void>[]): void {
    const all = anyArrives(pending);
    if (!all) {
      doc.waiting = null;
      return;
    }
    // Waits for all of it to settle, and recompiles if anything arrived: a family no catalogue has
    // doesn't hold back the ones that loaded.
    const waiting = { pending: all, params };
    doc.waiting = waiting;
    waiting.pending.then(
      () => {
        this.chain = this.chain.then(() => this.recompileWaiting(doc, waiting));
      },
      (e: unknown) => {
        if (doc.waiting !== waiting || this.docs.get(params.uri) !== doc) return;
        doc.waiting = null;
        const message = e instanceof Error ? e.message : String(e);
        this.post({ method: "$/log", params: { level: "warn", message: `compiling without it: ${message}` } });
      },
    );
  }

  /**
   * Compiles a document again once what its last compile lacked has arrived,
   * publishing output for the same revision. Skipped when it was closed,
   * edited or compiled again since: the client's next compile has it.
   */
  private async recompileWaiting(doc: Doc, waiting: NonNullable<Doc["waiting"]>): Promise<void> {
    const { uri, rev } = waiting.params;
    if (this.phase !== "ready" || doc.waiting !== waiting || this.docs.get(uri) !== doc) return;
    doc.waiting = null;
    if (doc.rev !== rev) return;
    try {
      await this.handlers.compile({ ...waiting.params, fullPages: false }, performance.now());
    } catch (e) {
      if (isTrap(e) && this.options.onFatal) {
        this.phase = "shutdown";
        this.options.onFatal(e);
        return;
      }
      this.post({
        method: "$/log",
        params: { level: "error", message: `recompile of ${uri}: ${e instanceof Error ? e.message : String(e)}` },
      });
    }
  }

  /**
   * What a compile lacked that is on its way: lazy fonts (the adapter's
   * `pending`), and the families its warnings name that the document's font
   * catalogues have.
   */
  private lacking(doc: Doc, r: AdapterCompileResult): Promise<void> | undefined {
    const fonts = this.fonts.missing(r.diagnostics, doc.catalogues);
    return fonts && r.pending ? anyArrives([r.pending, fonts]) : (fonts ?? r.pending);
  }

  /** An export's compile, once more after what it lacked arrived (within {@link EXPORT_WAIT_MS}). */
  private async exportOnce<R extends AdapterCompileResult>(doc: Doc, compile: () => R | Promise<R>): Promise<R> {
    const r = await compile();
    const pending = this.lacking(doc, r);
    return pending && (await arrives(pending, EXPORT_WAIT_MS)) ? compile() : r;
  }

  /**
   * The server's fixers plus those of a document's fixer modules. Unlike
   * `initialize`'s, a module that fails to load doesn't fail the request (the
   * client would only see the document missing): the document compiles
   * without it, and the failure is logged.
   */
  private async documentFixers(urls: readonly string[]): Promise<DiagnosticFixer[]> {
    const own = [...new Set(this.clientModules(urls))].filter((url) => !this.sharedModules.has(url));
    if (!own.length) return this.fixers;
    const loaded = await Promise.all(
      own.map(async (url) => {
        const load = this.documentModules.get(url) ?? loadFixers(url);
        this.documentModules.set(url, load);
        try {
          return await load;
        } catch (e) {
          // Tried again by the next document that lists it.
          this.documentModules.delete(url);
          this.post({
            method: "$/log",
            params: { level: "error", message: e instanceof Error ? e.message : String(e) },
          });
          return [];
        }
      }),
    );
    return orderFixers([...this.fixers, ...loaded.flat()]);
  }

  /** The fixer modules of a client's list the server may import: none unless it trusts the client. */
  private clientModules(urls: readonly string[]): readonly string[] {
    if (this.options.clientFixers !== false || !urls.length) return urls;
    this.post({ method: "$/log", params: { level: "warn", message: "ignored the client's fixer modules" } });
    return [];
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
      this.packages.setClientPackages(params.options?.packages);
      this.fonts.setClient(params.options?.fontCatalogues);
      const urls = this.clientModules(params.options?.fixerModules ?? []);
      try {
        const [, modules] = await Promise.all([
          this.adapter.init(params.options ?? {}),
          Promise.all(urls.map(loadFixers)),
        ]);
        this.fixers = orderFixers([...(this.options.fixers ?? DEFAULT_FIXERS), ...modules.flat()]);
        this.sharedModules = new Set(urls);
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
          ...(this.fonts.enabled ? { fontCatalogues: true } : {}),
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

    "document/open": async ({ uri, rev, text, preamble, files, packages, fixerModules, fontCatalogues }) => {
      this.ready();
      if (this.docs.has(uri)) throw new ProtocolError("document-already-open", `document ${uri} is already open`);
      const fixers = await this.documentFixers(fixerModules ?? []);
      const compiler = this.adapter.open();
      const keys = new Set<string>();
      try {
        // Before the document's files, so one at the same path replaces it.
        compiler.setFiles({ [RUNTIME_PATH]: RUNTIME });
        if (files) this.writeFiles(compiler, files, keys);
      } catch (e) {
        compiler.close();
        throw e;
      }
      const doc: Doc = {
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
        pageFormat: "svg",
        memo: null,
        shown: null,
        waiting: null,
        // A package arriving changes the files, so what the fallback learnt no longer holds.
        packages: new DocumentPackages(this.packages, packages, (files) => {
          compiler.setFiles(files);
          doc.memo = null;
        }),
        fixers,
        catalogues: this.fonts.forDocument(fontCatalogues),
        files: keys,
      };
      this.docs.set(uri, doc);
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
      this.writeFiles(doc.compiler, files, doc.files);
      doc.rev = rev;
      doc.memo = null;
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
      const fallback = fallbackOf(params.fallback, doc.text.length);
      const anchors = target === "html" && params.anchors !== false;
      // Imported packages load first, within the fix budget; any later arrival compiles again.
      const waiting = await doc.packages.prepare(doc.prefix + doc.text, received + FIX_BUDGET_MS[mode]);
      if (waiting) this.recompile(waiting.loading, params);
      this.sync(doc, params.inputs, anchors);
      const settled =
        mode === "streaming" && params.settled !== undefined
          ? Math.max(0, Math.min(params.settled, doc.text.length))
          : doc.text.length;
      // Changed pages only when the client can apply them to the pages it has.
      const pageFormat = params.pageFormat ?? "svg";
      const drawings = pageFormat === "drawing";
      let full =
        params.fullPages === true || !this.client.pagedDiff || doc.pagedBase === null || doc.pageFormat !== pageFormat;
      // The last compile, whose output is published, and the time spent in Typst.
      let r: Compiled | null = null;
      // What the fixers fixed in the last attempt, whose compile is `r`.
      let fixes: AppliedFix[] = [];
      let compileMs: number | undefined;
      let fixMs: number | undefined;
      const count = (ms: number | undefined) => {
        if (ms !== undefined) compileMs = (compileMs ?? 0) + ms;
      };
      // What compiles lacked that is on its way (lazy fonts, catalogues' families): the document is compiled
      // again once it arrives.
      const pending: Promise<void>[] = [];
      const compile = async (): Promise<Compiled> => {
        r = await this.compileMain(doc, target, mode, full, drawings);
        count(r.compileMs);
        const lacking = this.lacking(doc, r);
        if (lacking) pending.push(lacking);
        return r;
      };

      /**
       * Images the document has no file for, as placeholders from the start: Typst stops at the
       * first, so they'd take a fix round each. `null` when there are none (or no `missing-image`).
       */
      const placeholders = (given: Variant) => {
        const images = doc.fixers.includes(missingImage)
          ? placeholderImages(given.text, (k) => doc.files.has(k))
          : null;
        if (!images) return null;
        const { text, map } = applyEdits(given.text, images.edits, "fix");
        const variant: Variant = { text, toOriginal: (p, a) => given.toOriginal(map.toOriginal(p, a), a) };
        return { variant, map, errors: images.errors };
      };

      /**
       * Compiles the document's text, or a variant the fallback made of it,
       * and fixes it (Layer 3). Diagnostics in document coordinates.
       */
      const attempt = async (variant: Variant | null, settledIn: number): Promise<Attempt> => {
        const given: Variant = variant ?? { text: doc.text, toOriginal: (p) => p };
        const images = placeholders(given);
        const base = images?.variant ?? given;
        const settledBase = images ? images.map.toResult(settledIn) : settledIn;
        if (variant || images) this.writeFixed(doc, base.text, anchors, base.toOriginal);
        else this.sync(doc, params.inputs, anchors);
        let { diagnostics } = await compile();
        let ok = !diagnostics.some(isError);
        fixes = [];
        let compiled = base;
        if (!ok && doc.fixers.length > 0) {
          const fixStart = performance.now();
          const outcome = await runFixers({
            text: base.text,
            settled: settledBase,
            mode,
            fixers: doc.fixers,
            diagnostics,
            deadline: received + FIX_BUDGET_MS[mode],
            compile: async (text, toBase) => {
              this.writeFixed(doc, text, anchors, (p) => base.toOriginal(toBase(p)));
              return (await compile()).diagnostics;
            },
          });
          ({ ok, diagnostics, fixes } = outcome);
          compiled = { text: outcome.text, toOriginal: (p, a) => base.toOriginal(outcome.toOriginal(p, a), a) };
          if (outcome.rounds > 0) fixMs = (fixMs ?? 0) + performance.now() - fixStart;
        }
        if (images && ok) {
          // Reported as fixed errors are: info while streaming, the error in final mode.
          const reported = images.errors.map((d) =>
            mode === "final" ? d : { ...d, severity: "info" as const, source: missingImage.name },
          );
          diagnostics = [...toDocument(diagnostics, base), ...toDocument(reported, given)];
          fixes = [...images.errors.map((d) => ({ fixer: missingImage.name, message: d.message })), ...fixes];
          return { ok, diagnostics, compiled };
        }
        return { ok, diagnostics: variant || images ? toDocument(diagnostics, base) : diagnostics, compiled };
      };

      /** Compiles a variant for its errors only (the fallback's checks of prefixes). */
      const check = async (given: Variant): Promise<Diagnostic[]> => {
        // A missing image fails no block: it shows as a placeholder.
        const variant = placeholders(given)?.variant ?? given;
        this.writeFixed(doc, variant.text, false, variant.toOriginal);
        let c: { diagnostics: Diagnostic[]; compileMs?: number };
        if (doc.compiler.check) c = await doc.compiler.check({ target, mode });
        else if (target === "html") c = await doc.compiler.compileHtml({ mode });
        else {
          const paged = await doc.compiler.compilePaged({ fullPages: true, drawings, mode });
          // It moved the adapter's baseline: the artifact sends every page.
          if (paged.output) full = true;
          c = paged;
        }
        count(c.compileMs);
        return toDocument(this.diagnostics(doc, c.diagnostics), variant).filter(isError);
      };

      const skip = fallback?.skip ?? [];
      // With skipped ranges, the text as it is hangs: only the fallback compiles it.
      let outcome: Attempt =
        skip.length > 0
          ? { ok: false, diagnostics: [], compiled: { text: doc.text, toOriginal: (p) => p } }
          : await attempt(null, settled);
      let recovered: CompileFallback | undefined;
      let fallbackMs: number | undefined;
      if (!outcome.ok && fallback && (fallback.isolate || fallback.stablePrefix || skip.length > 0)) {
        const start = performance.now();
        let last: Attempt | null = null;
        const memoKey = target;
        const rec = await recover({
          text: doc.text,
          settled,
          mode,
          isolate: fallback.isolate === true,
          stablePrefix: mode === "streaming" && fallback.stablePrefix === true,
          skip,
          errors: skip.length > 0 ? null : outcome.diagnostics,
          attempt: async (variant, settledIn) => {
            last = await attempt(variant, settledIn);
            return last;
          },
          check,
          deadline: received + FALLBACK_BUDGET_MS[mode],
          memo: doc.memo,
          memoKey,
        });
        fallbackMs = performance.now() - start;
        if (rec) {
          // Its last attempt is the one that compiled.
          const { compiled } = (last as Attempt | null) ?? outcome;
          outcome = { ok: true, diagnostics: rec.diagnostics, compiled };
          recovered = { level: rec.level, isolated: rec.isolated, plainFrom: rec.plainFrom };
          doc.memo = rec.memo;
        } else if (skip.length > 0 && last) {
          outcome = last;
        }
      }
      const diagnostics = [...outcome.diagnostics, ...doc.packages.substitutions(doc.text)];
      this.post({ method: "document/diagnostics", params: { uri, rev, target, diagnostics } });
      // Fallback level 1 (#65): a compile that shows less of the tail than the last artifact keeps that
      // one, as a failed compile does, until the tail shows as much again or that text is settled. A cut
      // drops everything after it, so it never shows more meanwhile; nor does the stable prefix (level 2)
      // put a tail that rendered back to its source. The tail as plain text is for a block that never rendered.
      const kept =
        outcome.ok &&
        mode === "streaming" &&
        fallback !== null &&
        doc.shown?.target === target &&
        // The stable prefix replaces the tail from the start of its block, which may be settled text.
        showsLess(doc.shown.text, outcome.compiled.text, outcome.compiled.toOriginal, recovered?.plainFrom ?? settled);
      // The last compile's output: the first one's, or a fixed or fallback text's.
      const out = outcome.ok && !kept ? (r as Compiled | null) : null;
      // The adapter's changed pages now diff against output the client never got.
      if (kept) doc.pagedBase = null;
      if (out && "html" in out && out.html !== null) {
        this.post({ method: "document/artifact", params: { uri, rev, artifact: { target: "html", html: out.html } } });
        doc.pagedBase = null;
      } else if (out && "output" in out && out.output) {
        const { pageCount, changed, islands } = out.output;
        const { offset } = doc;
        const { toOriginal } = outcome.compiled;
        this.post({
          method: "document/artifact",
          params: {
            uri,
            rev,
            artifact: {
              target: "paged",
              base: full ? null : doc.pagedBase,
              pageCount,
              pages: changed,
              // An island's source, as diagnostics are: past the preamble, in the text the client sent.
              ...(islands && {
                islands: islands.map((i) => ({
                  ...i,
                  from: i.from === null || i.from < offset ? null : toOriginal(i.from - offset),
                })),
              }),
            },
          },
        });
        doc.pagedBase = rev;
        doc.pageFormat = pageFormat;
      }
      this.await(doc, params, pending);
      const ok = out !== null && ("html" in out ? out.html !== null : out.output !== null);
      if (ok) doc.shown = recovered?.plainFrom == null ? { target, text: outcome.compiled.text } : null;
      const result: CompileResult = {
        uri,
        rev,
        target,
        status: ok ? "ok" : "error",
        timings: { totalMs: performance.now() - received },
      };
      if (compileMs !== undefined) result.timings.compileMs = compileMs;
      if (r !== null && (r as Compiled).exportMs !== undefined) result.timings.exportMs = (r as Compiled).exportMs;
      if (fixMs !== undefined) result.timings.fixMs = fixMs;
      if (fallbackMs !== undefined) result.timings.fallbackMs = fallbackMs;
      if (ok && recovered) result.fallback = recovered;
      if (ok && fixes.length > 0) result.fixes = fixes;
      const memoryBytes = this.adapter.memoryBytes?.();
      if (memoryBytes !== undefined) result.memoryBytes = memoryBytes;
      return result;
    },

    "export/html": async ({ uri, rev, inputs }: ExportParams): Promise<ExportResult<string>> => {
      const doc = this.current(uri, rev);
      if (!this.adapter.exports.includes("html")) this.unsupported("HTML export");
      await doc.packages.prepare(doc.prefix + doc.text, performance.now() + FIX_BUDGET_MS.final);
      this.sync(doc, inputs);
      const r = await this.exportOnce(doc, () => doc.compiler.compileHtml({ mode: "final" }));
      const diagnostics = this.diagnostics(doc, r.diagnostics);
      return r.html === null
        ? { uri, rev, diagnostics, status: "error" }
        : { uri, rev, diagnostics, status: "ok", data: r.html };
    },

    "export/pdf": async ({ uri, rev, inputs }: ExportParams): Promise<ExportResult<Uint8Array>> => {
      const doc = this.current(uri, rev);
      if (!this.adapter.exports.includes("pdf") || !doc.compiler.exportPdf) this.unsupported("PDF export");
      await doc.packages.prepare(doc.prefix + doc.text, performance.now() + FIX_BUDGET_MS.final);
      this.sync(doc, inputs);
      const exportPdf = doc.compiler.exportPdf.bind(doc.compiler);
      const r = await this.exportOnce(doc, () => exportPdf({ mode: "final" }));
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
