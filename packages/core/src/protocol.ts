// The protocol between the main thread (client) and the engine worker (server),
// PLAN §6.1. LSP-shaped: `{ id, method, params }` requests answered by
// `{ id, result | error }`, plus `{ method, params }` notifications. Messages are
// plain structured-clonable data (no classes, no functions), so they cross
// `postMessage` as they are and could cross a socket as JSON later (bytes aside).
//
// Lifecycle: `initialize` first, then any number of documents, each opened,
// edited, compiled and closed independently; `shutdown` last. Documents share
// the worker's fonts, packages and Typst's memoization cache.

import type { Diagnostic } from "./diagnostic";
import type { Range, TextEdit } from "./index";
import type { FontSource, PackageSpec } from "./plugin";

/**
 * Bumped only for breaking changes. Additive changes (new methods, new optional
 * fields) don't bump it; they are announced through capabilities instead.
 * @public
 */
export const PROTOCOL_VERSION = 1;

/**
 * Names a document within one worker. Any string unique among the worker's
 * open documents (a chat message id, an editor tab); it need not be a URL.
 * @public
 */
export type DocumentUri = string;

/**
 * A document's version. Chosen by the client: an integer that increases with
 * every change to the document (not necessarily by one). Everything derived from
 * a document (diagnostics, artifacts, results) carries the revision it was
 * derived from, so the client can drop stale output.
 * @public
 */
export type Revision = number;

/** @public */
export type CompileTarget = "html" | "paged";

/** @public */
export type ExportFormat = "pdf" | "html";

/** Contents of a virtual file. Strings are UTF-8 text files. @public */
export type FileContent = string | Uint8Array;

/** Virtual files to write, by path relative to the document root; `null` deletes. @public */
export type FileDelta = Record<string, FileContent | null>;

/**
 * Base of every document-scoped message: which document, at which revision.
 * Protocol-level messages (`initialize`, `shutdown`, `$/cancel`, `$/log`) are
 * not about a document and have neither.
 * @public
 */
export interface DocumentParams {
  uri: DocumentUri;
  rev: Revision;
}

// ---------------------------------------------------------------------------
// initialize

/** What the client can handle. Missing fields mean "no". @public */
export interface ClientCapabilities {
  /**
   * The client can apply changed-page updates ({@link PagedArtifact} with a
   * `base`). Without it the server sends every page on every compile.
   */
  pagedDiff?: boolean;
  /** Not yet standardized; keys should be namespaced. */
  experimental?: Record<string, unknown>;
}

/**
 * What the server offers. Clients must treat a missing field as unsupported,
 * so later protocol versions can add editor services (`completion`, `hover`,
 * `definition`, `signatureHelp`, `format`, `foldingRanges`) as new flags
 * without a version bump.
 * @public
 */
export interface ServerCapabilities {
  targets: CompileTarget[];
  exports: ExportFormat[];
  /** Paged compiles send only pages that changed. Requires the client's `pagedDiff`. */
  pagedDiff?: boolean;
  /** `resolve/span` is implemented. @beta */
  resolveSpan?: boolean;
  /** `resolve/location` is implemented. @beta */
  resolveLocation?: boolean;
  experimental?: Record<string, unknown>;
}

/**
 * Resources shared by every document in the worker. Each document still gets
 * its own files and preamble (`document/open`).
 * @beta
 */
export interface InitializeOptions {
  fonts?: FontSource[];
  packages?: PackageSpec[];
}

/** @public */
export interface InitializeParams {
  /** The client's {@link PROTOCOL_VERSION}. */
  protocolVersion: number;
  capabilities: ClientCapabilities;
  clientInfo?: { name: string; version?: string };
  options?: InitializeOptions;
}

/**
 * On a version the server doesn't speak, it answers with a
 * `protocol-version-mismatch` error whose `data` is {@link VersionMismatchData}.
 * @public
 */
export interface InitializeResult {
  protocolVersion: number;
  capabilities: ServerCapabilities;
  serverInfo: {
    /** Adapter name, e.g. `"engine-wasm"`. */
    name: string;
    version?: string;
    /** The Typst version compiling documents, e.g. `"0.15.1"`. */
    typstVersion: string;
  };
}

/** @public */
export interface VersionMismatchData {
  supported: number[];
}

// ---------------------------------------------------------------------------
// documents

/**
 * Opens a document at revision `rev`. `text` is what gets compiled: in the
 * streaming pipeline that's the healed source, not the raw stream.
 * @public
 */
export interface DocumentOpenParams extends DocumentParams {
  text: string;
  /**
   * Typst evaluated before `text` (theme, `@typstream/edu` imports). It is not
   * part of the document's coordinates: diagnostics inside it report its path in
   * `Diagnostic.file`, never offsets into `text`.
   */
  preamble?: string;
  /** Files the document can read (images, data), relative to its root. */
  files?: FileDelta;
}

/**
 * Changes an open document to revision `rev`. `edits` apply in order, each to
 * the result of the previous one (so offsets of later edits are in the
 * already-edited text), starting from the text at the last accepted revision.
 * `rev` must exceed it; otherwise the server answers `stale-revision`.
 * A full replacement is one edit over the whole text.
 * @public
 */
export interface DocumentEditParams extends DocumentParams {
  edits: TextEdit[];
}

/**
 * Writes or deletes files of an open document. Changing what the document
 * reads changes its output, so this is a new revision too.
 * @public
 */
export interface DocumentSetFilesParams extends DocumentParams {
  files: FileDelta;
}

/** Closes a document; `rev` is its last revision. The server frees its state. @public */
export interface DocumentCloseParams extends DocumentParams {}

// ---------------------------------------------------------------------------
// compile

/**
 * `streaming` compiles may apply streaming-only fixers and are expected to be
 * superseded; `final` compiles the finished document (PLAN §5.7). @public
 */
export type CompileMode = "streaming" | "final";

/**
 * Compiles the document as of revision `rev`, which must be its current
 * revision (otherwise `content-modified`: the client should compile the newer
 * one instead).
 *
 * Output arrives as notifications, sent **before** the response, in this
 * order: `document/diagnostics` (always), then `document/artifact` (only when
 * the compile succeeded). The response then says the compile is over. This
 * keeps one rendering path for client-requested compiles and the ones the
 * server starts itself (e.g. when a lazily loaded font arrives).
 * @public
 */
export interface CompileParams extends DocumentParams {
  target: CompileTarget;
  /** `sys.inputs` for this compile (answer-key toggle, fit-width page size, theme). */
  inputs?: Record<string, string>;
  /** Default `streaming`. */
  mode?: CompileMode;
  /**
   * HTML only: insert source anchors at top-level blocks (PLAN §10.2).
   * Default true; exports never contain anchors.
   */
  anchors?: boolean;
  /**
   * Paged only: send every page, not just changed ones (the client lost or
   * dropped its pages, e.g. after remounting).
   */
  fullPages?: boolean;
}

/** Wall-clock milliseconds measured in the worker. @public */
export interface CompileTimings {
  /** From receiving the request to sending the response. */
  totalMs: number;
  /** Typst compilation (evaluation + layout), summed over fixer rounds. */
  compileMs?: number;
  /** Turning the document into HTML or SVG. */
  exportMs?: number;
  /** Diagnostic fixers (Layer 3), including the recompiles they caused. */
  fixMs?: number;
}

/** @public */
export interface CompileResult extends DocumentParams {
  target: CompileTarget;
  /** `ok`: an artifact was published. `error`: only diagnostics; the client keeps its last good artifact. */
  status: "ok" | "error";
  timings: CompileTimings;
  /** Engine memory after the compile (e.g. wasm memory), for recycling decisions (PLAN §6.3). */
  memoryBytes?: number;
}

/** Compiled HTML. @public */
export interface HtmlArtifact {
  target: "html";
  /** The complete HTML document Typst exported. Untrusted: the renderer sanitizes it. */
  html: string;
}

/** One rendered page of a paged artifact. Sizes in Typst points. @public */
export interface PageUpdate {
  /** Zero-based page index. */
  index: number;
  /** Hash of the page's frame. Equal hashes mean identical pages; use it as a key. */
  hash: string;
  width: number;
  height: number;
  /** Untrusted SVG markup: the renderer sanitizes it. */
  svg: string;
}

/**
 * Compiled pages. With `base === null` it holds every page. Otherwise it holds
 * only pages that changed since the paged artifact of revision `base` (the
 * previous one the server sent for this document); pages it doesn't list are
 * unchanged, and pages at or past `pageCount` no longer exist. A client whose
 * displayed pages aren't from `base` must not apply it and should recompile
 * with `fullPages`.
 * @public
 */
export interface PagedArtifact {
  target: "paged";
  base: Revision | null;
  pageCount: number;
  /** Ascending by index. */
  pages: PageUpdate[];
}

/** @public */
export type Artifact = HtmlArtifact | PagedArtifact;

// ---------------------------------------------------------------------------
// export

/**
 * Exports the document at revision `rev` (which must be current) in a final,
 * anchor-free form, for download or printing (PLAN §6.5).
 * @public
 */
export interface ExportParams extends DocumentParams {
  inputs?: Record<string, string>;
}

/**
 * `ok` carries the bytes or text; `error` means the document doesn't compile.
 * Diagnostics are included either way.
 * @public
 */
export type ExportResult<Data> = DocumentParams & { diagnostics: Diagnostic[] } & (
    | { status: "ok"; data: Data }
    | { status: "error" }
  );

// ---------------------------------------------------------------------------
// resolve (reserved: basic paged support in v1, the rest for the editor)

/** A point on a page, in Typst points from the page's top-left corner. @beta */
export interface PagePoint {
  page: number;
  x: number;
  y: number;
}

/**
 * Which source a point on a page came from (click-to-edit), in the paged
 * output of revision `rev`. HTML output maps blocks back in the renderer
 * through anchors instead (PLAN §10.2); finer HTML resolution would extend these
 * params, not replace them.
 * @beta
 */
export interface ResolveSpanParams extends DocumentParams {
  point: PagePoint;
}

/** @beta */
export interface ResolveSpanResult extends DocumentParams {
  /** `null` when nothing in the document produced that point. */
  span: Range | null;
}

/** Where a document offset ended up in the paged output (cursor sync). @beta */
export interface ResolveLocationParams extends DocumentParams {
  offset: number;
}

/** @beta */
export interface ResolveLocationResult extends DocumentParams {
  /** Every place the offset was laid out (content can repeat, e.g. headers); empty if none. */
  locations: PagePoint[];
}

// ---------------------------------------------------------------------------
// notifications

/**
 * Asks the server to drop a request it hasn't started. Typst compiles can't be
 * interrupted midway (the watchdog terminates the worker instead, PLAN §6.3),
 * so a running request still completes; a cancelled one answers
 * `request-cancelled` and publishes nothing.
 * @public
 */
export interface CancelParams {
  id: RequestId;
}

/**
 * The complete set of diagnostics for one compile of a document. It replaces
 * any earlier set for the same document and target (as LSP's
 * `publishDiagnostics` does). A later set for the same revision replaces an
 * earlier one: the server recompiled on its own.
 * @public
 */
export interface DiagnosticsNotification extends DocumentParams {
  target: CompileTarget;
  diagnostics: Diagnostic[];
}

/**
 * A successful compile's output. A later artifact for the same revision and
 * target replaces an earlier one (server-initiated recompile).
 * @public
 */
export interface ArtifactNotification extends DocumentParams {
  artifact: Artifact;
}

/** Engine messages for debugging; never user-facing. @public */
export interface LogParams {
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

// ---------------------------------------------------------------------------
// method tables

/**
 * Every request: method name → params and result. Adding a method here adds
 * it to {@link Request}, {@link Response} and their helpers.
 * @public
 */
export interface RequestMap {
  initialize: { params: InitializeParams; result: InitializeResult };
  /** Frees everything; the server answers nothing afterwards. */
  shutdown: { params: null; result: null };
  "document/open": { params: DocumentOpenParams; result: null };
  "document/edit": { params: DocumentEditParams; result: null };
  "document/setFiles": { params: DocumentSetFilesParams; result: null };
  "document/close": { params: DocumentCloseParams; result: null };
  compile: { params: CompileParams; result: CompileResult };
  "export/pdf": { params: ExportParams; result: ExportResult<Uint8Array> };
  "export/html": { params: ExportParams; result: ExportResult<string> };
  /** @beta */
  "resolve/span": { params: ResolveSpanParams; result: ResolveSpanResult };
  /** @beta */
  "resolve/location": { params: ResolveLocationParams; result: ResolveLocationResult };
}

/** Notifications the client sends. @public */
export interface ClientNotificationMap {
  "$/cancel": CancelParams;
}

/** Notifications the server sends. @public */
export interface ServerNotificationMap {
  "document/diagnostics": DiagnosticsNotification;
  "document/artifact": ArtifactNotification;
  "$/log": LogParams;
}

/** @public */
export type RequestMethod = keyof RequestMap;
/** @public */
export type ClientNotificationMethod = keyof ClientNotificationMap;
/** @public */
export type ServerNotificationMethod = keyof ServerNotificationMap;

/** Params of a request method. @public */
export type ParamsOf<M extends RequestMethod> = RequestMap[M]["params"];
/** Result of a request method. @public */
export type ResultOf<M extends RequestMethod> = RequestMap[M]["result"];

/** Chosen by the client, unique among its pending requests. @public */
export type RequestId = number;

/** A request, discriminated by `method`. `Request` alone is the union of all of them. @public */
export type Request<M extends RequestMethod = RequestMethod> = {
  [K in M]: { id: RequestId; method: K; params: ParamsOf<K> };
}[M];

/** @public */
export type ClientNotification<M extends ClientNotificationMethod = ClientNotificationMethod> = {
  [K in M]: { method: K; params: ClientNotificationMap[K] };
}[M];

/** @public */
export type ServerNotification<M extends ServerNotificationMethod = ServerNotificationMethod> = {
  [K in M]: { method: K; params: ServerNotificationMap[K] };
}[M];

/**
 * Why a request failed. Protocol failures only: a document that doesn't
 * compile is a successful `compile` with `status: "error"`.
 * @public
 */
export type ErrorCode =
  /** Any request before `initialize`, or after `shutdown`. */
  | "not-initialized"
  /** `initialize` with a protocol version the server doesn't speak. */
  | "protocol-version-mismatch"
  | "method-not-found"
  | "invalid-params"
  /** A document request for a `uri` that isn't open. */
  | "document-not-open"
  | "document-already-open"
  /** An edit whose `rev` doesn't exceed the document's current revision. */
  | "stale-revision"
  /** A compile/export/resolve for a revision that is no longer current. */
  | "content-modified"
  | "request-cancelled"
  /** A method or target the server's capabilities don't include. */
  | "unsupported"
  /** A bug or crash in the engine. */
  | "internal";

/** The wire form of a failure. Rebuild a throwable with {@link ProtocolError.from}. @public */
export interface ResponseError {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

/** @public */
export type SuccessResponse<M extends RequestMethod = RequestMethod> = {
  [K in M]: { id: RequestId; result: ResultOf<K> };
}[M];

/** @public */
export interface ErrorResponse {
  id: RequestId;
  error: ResponseError;
}

/**
 * The answer to a request with method `M`. Responses don't repeat the method:
 * the client knows it from the id.
 * @public
 */
export type Response<M extends RequestMethod = RequestMethod> = SuccessResponse<M> | ErrorResponse;

/** Anything the client posts to the worker. @public */
export type ClientMessage = Request | ClientNotification;

/** Anything the worker posts to the client. @public */
export type ServerMessage = Response | ServerNotification;

// ---------------------------------------------------------------------------
// helpers

/** @public */
export const isRequest = (m: ClientMessage): m is Request => "id" in m;

/** @public */
export const isClientNotification = (m: ClientMessage): m is ClientNotification => !("id" in m);

/** @public */
export const isResponse = (m: ServerMessage): m is Response => "id" in m;

/** @public */
export const isServerNotification = (m: ServerMessage): m is ServerNotification => !("id" in m);

/** @public */
export const isErrorResponse = (m: Response): m is ErrorResponse => "error" in m;

/**
 * A protocol failure as a throwable, for the client to reject a request's
 * promise with. Errors lose their class when posted, so the wire carries
 * {@link ResponseError}; convert with {@link ProtocolError.from} and
 * {@link ProtocolError.toJSON}.
 * @public
 */
export class ProtocolError extends Error {
  readonly code: ErrorCode;
  readonly data: unknown;

  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.data = data;
  }

  static from(e: ResponseError): ProtocolError {
    return new ProtocolError(e.code, e.message, e.data);
  }

  toJSON(): ResponseError {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}
