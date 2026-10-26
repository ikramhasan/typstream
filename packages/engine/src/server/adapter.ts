// What the worker server needs from a Typst compiler (PLAN §6.1, §8.5). The
// server speaks the protocol and keeps documents, revisions, preambles and
// changed-page bookkeeping; an adapter only holds files and compiles them. The
// default adapter is engine-wasm (./engine-wasm.ts); others (typst.ts, a
// trimmed build) must pass the same conformance suite (PLAN §11.3).

import type {
  CompileMode,
  CompileTarget,
  Diagnostic,
  ExportFormat,
  FileContent,
  InitializeOptions,
  PageUpdate,
} from "@typstream/core";

/** A value, or a promise of it. @public */
export type MaybePromise<T> = T | Promise<T>;

/**
 * How a compile will be used. `mode` is the `compile` request's (default
 * `streaming`); exports are `final`. Adapters may budget or fix differently
 * per mode (PLAN §5.7, §6.3); engine-wasm ignores it.
 * @public
 */
export interface AdapterCompileOptions {
  mode?: CompileMode;
}

/**
 * A Typst compiler the worker server can host.
 * @public
 */
export interface EngineAdapter {
  /** Reported in `initialize`'s `serverInfo`. */
  readonly info: { name: string; version?: string; typstVersion: string };
  /** What it compiles to; reported in `initialize`'s capabilities. */
  readonly targets: readonly CompileTarget[];
  /** What `export/*` requests it serves. */
  readonly exports: readonly ExportFormat[];
  /**
   * Loads the compiler and its fonts: the adapter's own plus `options.fonts`
   * (from `initialize`). Called once, before anything else.
   */
  init(options: InitializeOptions): Promise<void>;
  /** A fresh compiler state for one document. */
  open(): AdapterDocument;
  /** Memory the compiler holds after a compile, for recycling (PLAN §6.3). */
  memoryBytes?(): number;
}

/**
 * One document's files and compiler state. Paths are absolute virtual paths;
 * `/main.typ` is the entry point and holds the document (after its preamble).
 * @public
 */
export interface AdapterDocument {
  /**
   * Writes files (strings are UTF-8 text) or, with `null`, deletes them.
   * Throws on a path the adapter can't hold.
   */
  setFiles(files: Record<string, FileContent | null>): void;
  /** `sys.inputs` for the following compiles. */
  setInputs(inputs: Record<string, string>): void;
  /** Compiles `/main.typ` to HTML. */
  compileHtml(options?: AdapterCompileOptions): MaybePromise<AdapterHtmlResult>;
  /**
   * Compiles paged output and returns the pages that changed since the last
   * successful paged compile, or every page with `fullPages` (or the first
   * time). A failed compile keeps what the next one diffs against.
   */
  compilePaged(options: { fullPages: boolean } & AdapterCompileOptions): MaybePromise<AdapterPagedResult>;
  /**
   * Compiles `/main.typ` for its diagnostics only, as the fallback does to
   * check prefixes of a document (PLAN §5.6). It must leave the baseline that
   * `compilePaged` diffs against alone. Optional: without it the server
   * compiles normally and sends every page with the next paged artifact.
   */
  check?(options: { target: CompileTarget } & AdapterCompileOptions): MaybePromise<AdapterCompileResult>;
  /** Compiles paged output to PDF. Only when the adapter's `exports` include `"pdf"`; always `final` mode. */
  exportPdf?(options?: AdapterCompileOptions): MaybePromise<AdapterCompileResult & { pdf: Uint8Array | null }>;
  /** Frees the document. */
  close(): void;
}

/**
 * What every compile returns. Diagnostics are in `/main.typ` coordinates
 * (UTF-16), in `@typstream/core`'s shape: the server moves them past the
 * preamble.
 * @public
 */
export interface AdapterCompileResult {
  /** Errors and warnings; a failed compile has at least one error. */
  diagnostics: Diagnostic[];
  /** Typst compilation (evaluation + layout). */
  compileMs?: number;
  /** Turning the document into HTML or SVG. */
  exportMs?: number;
}

/** `html` is `null` when the compile failed. @public */
export interface AdapterHtmlResult extends AdapterCompileResult {
  /** The exported HTML document. */
  html: string | null;
}

/** `null` when the compile failed. Pages ascending by index. @public */
export interface AdapterPagedResult extends AdapterCompileResult {
  /** The document's page count, and the pages to send. */
  output: { pageCount: number; changed: PageUpdate[] } | null;
}
