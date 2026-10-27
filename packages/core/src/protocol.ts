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
import type { DiagnosticFixer, FontCatalogue, FontSource, LoadedFontFamily, PackageSpec } from "./plugin";

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

/**
 * What a compile produces: `html`, Typst's HTML export ({@link HtmlArtifact}), or
 * `paged`, laid-out pages as SVG ({@link PagedArtifact}).
 * @public
 */
export type CompileTarget = "html" | "paged";

/** What `export/pdf` and `export/html` produce; servers list theirs in their capabilities. @public */
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
  /** The document the message is about. */
  uri: DocumentUri;
  /** The revision of it the message is about (see {@link Revision}). */
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
  /** The targets it compiles to; `compile` to another answers `unsupported`. */
  targets: CompileTarget[];
  /** The export formats it serves; the other `export/*` requests answer `unsupported`. */
  exports: ExportFormat[];
  /** Paged compiles send only pages that changed. Requires the client's `pagedDiff`. */
  pagedDiff?: boolean;
  /** `resolve/span` is implemented. @beta */
  resolveSpan?: boolean;
  /** `resolve/location` is implemented. @beta */
  resolveLocation?: boolean;
  /** Families named in documents load from font catalogues (`fontCatalogues`), announced by `fonts/loaded`. @beta */
  fontCatalogues?: boolean;
  /** Not yet standardized; keys should be namespaced. */
  experimental?: Record<string, unknown>;
}

/**
 * Resources shared by every document in the worker. Each document still gets
 * its own files and preamble (`document/open`).
 * @beta
 */
export interface InitializeOptions {
  /** Fonts for every document, in addition to the server's own. Lazy ones (with `info`) download on first use. */
  fonts?: FontSource[];
  /**
   * Packages every document may import, added to the server's own allowlist
   * (PLAN §6.4). A server facing untrusted clients may ignore them.
   */
  packages?: PackageSpec[];
  /**
   * ES module URLs the worker imports at `initialize`, each exporting a
   * {@link DiagnosticFixer} or an array of them as its default export
   * (PLAN §8.2; plugins' `engine.fixerModules`). A module that fails to load
   * fails `initialize`.
   */
  fixerModules?: string[];
  /**
   * Font libraries every document loads families it names from (PLAN §6.4;
   * plugins' `engine.fontCatalogues`). Each family loads once, for the worker.
   */
  fontCatalogues?: FontCatalogue[];
}

/**
 * The first request: the client's protocol version and capabilities, and the
 * resources every document in the worker shares.
 * @public
 */
export interface InitializeParams {
  /** The client's {@link PROTOCOL_VERSION}. */
  protocolVersion: number;
  /** What the client can handle; the server sends only what it can. */
  capabilities: ClientCapabilities;
  /** Who the client is, e.g. `{ name: "@typstream/react" }`. Informational, for logs. */
  clientInfo?: { name: string; version?: string };
  /** Fonts, packages, fixer modules and font catalogues every document shares. @beta */
  options?: InitializeOptions;
}

/**
 * On a version the server doesn't speak, it answers with a
 * `protocol-version-mismatch` error whose `data` is {@link VersionMismatchData}.
 * @public
 */
export interface InitializeResult {
  /** The server's {@link PROTOCOL_VERSION}: the client's, since any other fails `initialize`. */
  protocolVersion: number;
  /** What the server offers; clients use only what is listed. */
  capabilities: ServerCapabilities;
  /** Which engine answered, for logs and bug reports. */
  serverInfo: {
    /** Adapter name, e.g. `"engine-wasm"`. */
    name: string;
    version?: string;
    /** The Typst version compiling documents, e.g. `"0.15.1"`. */
    typstVersion: string;
  };
}

/** The `data` of a `protocol-version-mismatch` error. @public */
export interface VersionMismatchData {
  /** The protocol versions the server speaks. */
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
  /** The document's text at `rev`, which later `document/edit`s change. */
  text: string;
  /**
   * Typst evaluated before `text` (theme, `@typstream/edu` imports). It is not
   * part of the document's coordinates: diagnostics inside it report its path in
   * `Diagnostic.file`, never offsets into `text`.
   */
  preamble?: string;
  /**
   * Files the document can read (images, data), relative to its root. A key
   * such as `@typstream/edu:0.1.0/lib.typ` is a file of that package (its spec,
   * then the path inside it): files mounted this way make a local package
   * importable, with no allowlist or download.
   */
  files?: FileDelta;
  /**
   * Packages this document may import, in addition to `initialize`'s (plugins'
   * `engine.packages`). The server fetches one only when the document imports
   * it, and may ignore the list (a server facing untrusted clients). @beta
   */
  packages?: PackageSpec[];
  /**
   * Fixer modules for this document, in addition to `initialize`'s (plugins'
   * `engine.fixerModules`, PLAN §8.2). The server imports each once; one that
   * fails to load is reported with `$/log` and the document compiles without it.
   * @beta
   */
  fixerModules?: string[];
  /**
   * Font catalogues this document loads families from, in addition to
   * `initialize`'s. The fonts they load are the worker's, as every font is.
   * @beta
   */
  fontCatalogues?: FontCatalogue[];
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
  /** The changes, in order, each in UTF-16 offsets into the text the previous one left. */
  edits: TextEdit[];
}

/**
 * Writes or deletes files of an open document. Changing what the document
 * reads changes its output, so this is a new revision too.
 * @public
 */
export interface DocumentSetFilesParams extends DocumentParams {
  /** The files to write, by path relative to the document root; `null` deletes one. Others stay. */
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
  /** What to compile to: one of the server's `targets`. */
  target: CompileTarget;
  /** `sys.inputs` for this compile (answer-key toggle, fit-width page size, theme). */
  inputs?: Record<string, string>;
  /** Default `streaming`. */
  mode?: CompileMode;
  /**
   * Streaming only: the text before this offset is settled (heal's
   * `stableOffset`). Fixers may drop or rewrite only what comes after it, the
   * text still being typed (PLAN §5.5). Without it, all of the text counts as
   * settled.
   */
  settled?: number;
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
  /**
   * What the server may show when the text doesn't compile even after its
   * fixes (Layer 4, PLAN §5.6). Without it a failed compile publishes no
   * artifact and the client keeps its last good one.
   */
  fallback?: FallbackParams;
}

/**
 * Layer 4 of a compile (PLAN §5.6): how the server turns a document that
 * doesn't compile into one that does, rather than publishing no artifact.
 * @public
 */
export interface FallbackParams {
  /**
   * Show each top-level block that fails as an error box in place of the block
   * (`typstream.error-block`, with the error and the block's source), found
   * by compiling prefixes of the document (bisection). While streaming, only
   * blocks of the settled text are isolated; the unsettled tail is left to
   * the fixers and `stablePrefix`.
   */
  isolate?: boolean;
  /**
   * Streaming: when the unsettled tail fails, compile the settled text and
   * show the tail as plain text below it (level 2). Clients ask for it once
   * their last good render is too stale to keep showing.
   */
  stablePrefix?: boolean;
  /**
   * Parts of the text the client found the compiler can't get through: a
   * compile ran past the watchdog budget or crashed the worker (PLAN §6.3).
   * They are shown as error boxes without being compiled. Ranges are in the
   * text, ascending and not overlapping, and should cover whole top-level
   * blocks.
   */
  skip?: SkippedRange[];
}

/**
 * A part of the text the compiler can't get through (see {@link FallbackParams}).
 * @public
 */
export interface SkippedRange extends Range {
  /** What happened when it was compiled. */
  reason: "timeout" | "crash";
}

/**
 * How the artifact of a compile differs from the document, when Layer 4 made
 * it (PLAN §5.6). Ranges are in document coordinates.
 * @public
 */
export interface CompileFallback {
  /**
   * Which step of the ladder made it: `2` the settled text with the tail as
   * plain text (blocks of the settled text may be isolated too), `3` blocks
   * isolated, `4` the whole document as one error block (final mode).
   */
  level: 2 | 3 | 4;
  /** Blocks shown as error boxes, ascending: blocks that failed, and `skip`ped ranges. */
  isolated: Range[];
  /** Streaming: the unsettled text from here on was shown as plain text (`stablePrefix`), or `null`. */
  plainFrom: number | null;
}

/**
 * An error a diagnostic fixer (Layer 3, PLAN §5.5) fixed to make a compile's
 * output, for telemetry ("fixer hits by error", PLAN §12). @public
 */
export interface AppliedFix {
  /** The fixer's `name`. */
  fixer: string;
  /** The error's message, as Typst reported it. */
  message: string;
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
  /** The fallback (Layer 4), including its compiles. */
  fallbackMs?: number;
}

/**
 * The answer to `compile`, sent after its notifications: whether it published
 * an artifact, and what it cost.
 * @public
 */
export interface CompileResult extends DocumentParams {
  /** The target compiled to, as requested. */
  target: CompileTarget;
  /** `ok`: an artifact was published. `error`: only diagnostics; the client keeps its last good artifact. */
  status: "ok" | "error";
  /** Where the worker's time went. */
  timings: CompileTimings;
  /** Engine memory after the compile (e.g. wasm memory), for recycling decisions (PLAN §6.3). */
  memoryBytes?: number;
  /** Set when the artifact came from the fallback (`CompileParams.fallback`) rather than the text as it is. */
  fallback?: CompileFallback;
  /** The errors fixers fixed to make the artifact, in the order fixed. Absent when none were. */
  fixes?: AppliedFix[];
}

/** Compiled HTML. @public */
export interface HtmlArtifact {
  /** Discriminant: the output of an HTML compile. */
  target: "html";
  /** The complete HTML document Typst exported. Untrusted: the renderer sanitizes it. */
  html: string;
}

/**
 * A run of text drawn on a page, for a selectable text layer (the SVG draws
 * glyphs as paths). In points from the page's top left: `(x, y)` is the start
 * of the baseline (its left end, whatever the direction), `width` the run's
 * advance, `size` its font size.
 * @public
 */
export interface TextRun {
  /** The run's characters, in reading order. */
  text: string;
  /** Left end of the baseline, in points from the page's left edge. */
  x: number;
  /** The baseline, in points from the page's top edge. */
  y: number;
  /** Font size, in points. */
  size: number;
  /** The run's advance along the baseline, in points. */
  width: number;
  /** `[a, b, c, d]` of an SVG `matrix()` (translation is `x`/`y`); only for rotated, skewed or scaled text. */
  matrix?: [number, number, number, number];
  /** The run's language (`en`, `zh-CN`), only when it differs from the page's. */
  lang?: string;
  /** The direction the run was set in, only when it differs from the page's (and is known). */
  dir?: "ltr" | "rtl";
}

/**
 * A structure element around some of a page's text runs: a heading, a list or
 * its item, a table, a row or a cell.
 * @public
 */
export interface TextNode {
  /** The ARIA role a text layer gives it. */
  role: "heading" | "list" | "listitem" | "table" | "row" | "cell" | "columnheader";
  /** A heading's `aria-level`: the document's title is 1 and a Typst heading of level n is n + 1, as in the HTML target. */
  level?: number;
  /** Its runs are the page's `text[from..to)` (none for an empty cell). */
  from: number;
  /** End of its runs (exclusive). */
  to: number;
  /** The elements inside it, in order. */
  children?: TextNode[];
}

/** One rendered page of a paged artifact. Sizes in Typst points. @public */
export interface PageUpdate {
  /** Zero-based page index. */
  index: number;
  /** Hash of the page's frame. Equal hashes mean identical pages; use it as a key. */
  hash: string;
  /** Page width, in points. */
  width: number;
  /** Page height, in points. */
  height: number;
  /** Untrusted SVG markup: the renderer sanitizes it. */
  svg: string;
  /**
   * The page's text runs in reading (logical) order. Optional: other engines
   * may not provide them, nor the structure, language and direction.
   */
  text?: TextRun[];
  /** Headings, lists and tables around the runs, outermost first. */
  structure?: TextNode[];
  /** The document's language (`en`, `ar`, `zh-CN`). */
  lang?: string;
  /** The document's direction. */
  dir?: "ltr" | "rtl";
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
  /** Discriminant: the output of a paged compile. */
  target: "paged";
  /** The revision whose paged artifact this one updates, or `null` when it holds every page. */
  base: Revision | null;
  /** How many pages the document has now, whether or not they are in `pages`. */
  pageCount: number;
  /** Ascending by index. */
  pages: PageUpdate[];
}

/** What a successful compile publishes (`document/artifact`), by target. @public */
export type Artifact = HtmlArtifact | PagedArtifact;

// ---------------------------------------------------------------------------
// export

/**
 * Exports the document at revision `rev` (which must be current) in a final,
 * anchor-free form, for download or printing (PLAN §6.5).
 * @public
 */
export interface ExportParams extends DocumentParams {
  /** `sys.inputs` for the export (e.g. the answer-key toggle). */
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
  /** Zero-based page index, as {@link PageUpdate.index}. */
  page: number;
  /** Points from the page's left edge. */
  x: number;
  /** Points from the page's top edge. */
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
  /** The point on a page of revision `rev`'s paged output, e.g. where the user clicked. */
  point: PagePoint;
}

/** The answer to `resolve/span`. @beta */
export interface ResolveSpanResult extends DocumentParams {
  /** `null` when nothing in the document produced that point. */
  span: Range | null;
}

/** Where a document offset ended up in the paged output (cursor sync). @beta */
export interface ResolveLocationParams extends DocumentParams {
  /** UTF-16 offset into the document text at `rev`. */
  offset: number;
}

/** The answer to `resolve/location`. @beta */
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
  /** The id of the request to drop. */
  id: RequestId;
}

/**
 * The complete set of diagnostics for one compile of a document. It replaces
 * any earlier set for the same document and target (as LSP's
 * `publishDiagnostics` does). A later set for the same revision replaces an
 * earlier one: the server recompiled on its own.
 *
 * When diagnostic fixers (PLAN §5.5) made a compile succeed, it also lists the
 * errors they fixed, at their place in the document: in streaming compiles as
 * `info` with the fixer's name as `source` (the text is still being written);
 * in final ones as the errors they are, next to the artifact.
 * @public
 */
export interface DiagnosticsNotification extends DocumentParams {
  /** The target of the compile they come from. */
  target: CompileTarget;
  /** Every diagnostic of the compile, in document coordinates; empty when it had none. */
  diagnostics: Diagnostic[];
}

/**
 * A successful compile's output. A later artifact for the same revision and
 * target replaces an earlier one (server-initiated recompile).
 * @public
 */
export interface ArtifactNotification extends DocumentParams {
  /** The compiled output: an HTML document, or pages. */
  artifact: Artifact;
}

/**
 * A family the server loaded from a font catalogue, for every document from
 * now on. HTML renderers show it with the same files as web fonts (Typst's HTML
 * export leaves fonts to the browser). Sent once per family and worker.
 * @beta
 */
export type FontsLoadedParams = LoadedFontFamily;

/** Engine messages for debugging; never user-facing. @public */
export interface LogParams {
  /** How serious it is, as in `console`'s methods. */
  level: "debug" | "info" | "warn" | "error";
  /** The text of the message, for developers. */
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
  /** First request: agrees on the protocol version and capabilities, and loads shared resources. */
  initialize: { params: InitializeParams; result: InitializeResult };
  /** Frees everything; the server answers nothing afterwards. */
  shutdown: { params: null; result: null };
  /** Opens a document at its first revision. */
  "document/open": { params: DocumentOpenParams; result: null };
  /** Changes an open document's text, as a new revision. */
  "document/edit": { params: DocumentEditParams; result: null };
  /** Writes or deletes an open document's files, as a new revision. */
  "document/setFiles": { params: DocumentSetFilesParams; result: null };
  /** Closes a document and frees its state. */
  "document/close": { params: DocumentCloseParams; result: null };
  /** Compiles the current revision; the output arrives as notifications before the result. */
  compile: { params: CompileParams; result: CompileResult };
  /** The current revision as PDF bytes. Needs `pdf` in the server's `exports`. */
  "export/pdf": { params: ExportParams; result: ExportResult<Uint8Array> };
  /** The current revision as an HTML document, without anchors. Needs `html` in the server's `exports`. */
  "export/html": { params: ExportParams; result: ExportResult<string> };
  /** Click-to-edit: the source that made a point on a page. Needs `resolveSpan`. @beta */
  "resolve/span": { params: ResolveSpanParams; result: ResolveSpanResult };
  /** Cursor sync: where an offset was laid out on the pages. Needs `resolveLocation`. @beta */
  "resolve/location": { params: ResolveLocationParams; result: ResolveLocationResult };
}

/** Notifications the client sends. @public */
export interface ClientNotificationMap {
  /** Drops a request the server hasn't started (see {@link CancelParams}). */
  "$/cancel": CancelParams;
}

/** Notifications the server sends. @public */
export interface ServerNotificationMap {
  /** A compile's diagnostics: sent for every compile, before its artifact. */
  "document/diagnostics": DiagnosticsNotification;
  /** A successful compile's output, sent after its diagnostics. */
  "document/artifact": ArtifactNotification;
  /** A family loaded from a font catalogue; once per family and worker. @beta */
  "fonts/loaded": FontsLoadedParams;
  /** Engine messages for debugging; never user-facing. */
  "$/log": LogParams;
}

/** The name of a request method. @public */
export type RequestMethod = keyof RequestMap;
/** The name of a notification the client sends. @public */
export type ClientNotificationMethod = keyof ClientNotificationMap;
/** The name of a notification the server sends. @public */
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

/**
 * A notification the client sends, discriminated by `method`. It has no `id`
 * and gets no answer.
 * @public
 */
export type ClientNotification<M extends ClientNotificationMethod = ClientNotificationMethod> = {
  [K in M]: { method: K; params: ClientNotificationMap[K] };
}[M];

/**
 * A notification the server sends, discriminated by `method`. It has no `id`
 * and gets no answer.
 * @public
 */
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
  /** Why the request failed. */
  code: ErrorCode;
  /** Human-readable details, for logs. */
  message: string;
  /** Machine-readable details, e.g. {@link VersionMismatchData} for `protocol-version-mismatch`. */
  data?: unknown;
}

/** The answer to a request that succeeded: its result, under the request's `id`. @public */
export type SuccessResponse<M extends RequestMethod = RequestMethod> = {
  [K in M]: { id: RequestId; result: ResultOf<K> };
}[M];

/** The answer to a request that failed. @public */
export interface ErrorResponse {
  /** The id of the request that failed. */
  id: RequestId;
  /** Why it failed. */
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

/** Whether a client message is a request (it has an `id`) rather than a notification. @public */
export const isRequest = (m: ClientMessage): m is Request => "id" in m;

/** Whether a client message is a notification (it has no `id`) rather than a request. @public */
export const isClientNotification = (m: ClientMessage): m is ClientNotification => !("id" in m);

/** Whether a server message is a response (it has an `id`) rather than a notification. @public */
export const isResponse = (m: ServerMessage): m is Response => "id" in m;

/** Whether a server message is a notification (it has no `id`) rather than a response. @public */
export const isServerNotification = (m: ServerMessage): m is ServerNotification => !("id" in m);

/** Whether a response reports a failure (it has an `error`) rather than a result. @public */
export const isErrorResponse = (m: Response): m is ErrorResponse => "error" in m;

/**
 * A protocol failure as a throwable, for the client to reject a request's
 * promise with. Errors lose their class when posted, so the wire carries
 * {@link ResponseError}; convert with {@link ProtocolError.from} and
 * {@link ProtocolError.toJSON}.
 * @public
 */
export class ProtocolError extends Error {
  /** Why the request failed. */
  readonly code: ErrorCode;
  /** Machine-readable details, as in {@link ResponseError.data}; `undefined` when there are none. */
  readonly data: unknown;

  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.data = data;
  }

  /** Rebuilds the throwable from the wire form a response carried. */
  static from(e: ResponseError): ProtocolError {
    return new ProtocolError(e.code, e.message, e.data);
  }

  /** The wire form, to answer a request with; `data` only when there is some. */
  toJSON(): ResponseError {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}
