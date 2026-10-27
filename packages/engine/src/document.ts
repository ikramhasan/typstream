// One document on the main thread: heals its input, decides when to compile
// (PLAN §6.2), keeps the last good artifact when a compile fails (§5.6 step 1)
// and turns worker output into a state the renderer reads. The engine owns the
// worker and runs the compiles; see engine.ts.

import {
  type Artifact,
  type CompiledEvent,
  type CompileMode,
  type CompileParams,
  type CompileResult,
  type CompileTarget,
  type Diagnostic,
  type DocumentEvent,
  type DocumentUri,
  diffEdit,
  type ExportFormat,
  type ExportResult,
  type FallbackLevel,
  type FallbackParams,
  type FileDelta,
  type FontCatalogue,
  isError,
  mapDiagnostic,
  normalizeDiagnostics,
  type PackageSpec,
  ProtocolError,
  type RequestId,
  type Revision,
  type ServerNotification,
  type TextEdit,
  type TypstreamPlugin,
} from "@typstream/core";
import { createHealer, type Healer, type HealOptions, type HealResult } from "@typstream/heal";
import type { Clock } from "./clock";
import { type Connection, WorkerGone } from "./connection";
import { DocumentImages, type ImageResolver } from "./document-images";
import { HangSearch } from "./hang";
import { fileKey } from "./image-paths";
import { applyPaged } from "./paged";
import type { ResolvedDocumentOptions } from "./plugins";
import { compileInterval, type ScheduleOptions, updateEma } from "./schedule";

/**
 * Where a document is, for an "updating…" indicator or an error banner:
 *
 * - `idle`: the artifact shows the latest input; waiting for more.
 * - `compiling`: a compile is scheduled or running.
 * - `stale`: streaming, and the latest compile failed (see `failure`). The
 *   artifact is the last good one. It stays `stale` until a compile succeeds.
 * - `error`: the finished document failed to compile, or the engine can't run.
 * - `done`: the finished document compiled.
 * @public
 */
export type DocumentStatus = "idle" | "compiling" | "stale" | "error" | "done";

/**
 * Why the latest compile produced no artifact.
 *
 * - `diagnostics`: the source has errors (they are in `diagnostics`).
 * - `timeout`: the watchdog stopped a compile that ran past its budget.
 * - `crash`: the worker died during the compile.
 * - `too-complex`: repeated timeouts or crashes, or more pages than
 *   `limits.livePages`, stopped live compiling; the document compiles once
 *   more when it is finished.
 * - `too-large`: the input is longer than `limits.maxLength`. It isn't healed
 *   or compiled, finished or not, until `set()` or `reset()` makes it shorter.
 * - `engine`: the worker refused the request or couldn't start.
 * @public
 */
export interface CompileFailure {
  /** What went wrong, for choosing what to show. */
  reason: "diagnostics" | "timeout" | "crash" | "too-complex" | "too-large" | "engine";
  /** A sentence for logs or a tooltip: the first error, or what the engine did. */
  message: string;
}

/**
 * A snapshot of a document. A new object whenever anything in it changes, so
 * it can be compared by identity (React's `useSyncExternalStore`).
 * @public
 */
export interface DocumentState {
  /** See {@link DocumentStatus}. */
  status: DocumentStatus;
  /**
   * The last good artifact, or `null` before the first successful compile.
   * Paged artifacts are complete: every page, with `base: null`.
   */
  artifact: Artifact | null;
  /** Revision `artifact` was compiled from. */
  artifactRev: Revision | null;
  /**
   * Diagnostics of the latest compile, in input coordinates (offsets into the
   * text pushed so far, mapped back through healing), sorted.
   */
  diagnostics: Diagnostic[];
  /** Healing of the current input: the source sent to the worker, open frames, lint findings. */
  heal: HealResult;
  /** `finish()` was called: the input is complete and compiles in final mode. */
  final: boolean;
  /** False once the watchdog stopped live compiling (`failure.reason` is `too-complex`). */
  live: boolean;
  /** Set while the status is `stale` or `error`. */
  failure: CompileFailure | null;
  /** The worker's answer to the latest finished compile. */
  lastCompile: CompileResult | null;
}

/**
 * How to open a document.
 * @public
 */
export interface DocumentOptions {
  /** Unique among the engine's open documents. Default: a generated `doc-N`. */
  uri?: DocumentUri;
  /** Input to start from; it compiles right away. */
  text?: string;
  /** Default `html`. */
  target?: CompileTarget;
  /** `sys.inputs`. */
  inputs?: Record<string, string>;
  /** Typst evaluated before the document (theme, imports); fixed for the document's lifetime. */
  preamble?: string;
  /**
   * Files the document reads (images, data), relative to its root. Keys such as
   * `@typstream/edu:0.1.0/lib.typ` mount a local package.
   */
  files?: FileDelta;
  /**
   * Gives the bytes of images the document names but has no file for: URLs a
   * model wrote, or names the app knows. Without it, nothing is fetched, and
   * such images show as placeholders (as do the ones it can't resolve).
   * `fetchImages({ hosts })` from `@typstream/engine/images` downloads URLs
   * from the hosts you allow.
   */
  resolveImage?: ImageResolver;
  /**
   * Typst packages the document may import, in addition to the engine's
   * (`initialize.packages`); fixed for the document's lifetime. @beta
   */
  packages?: PackageSpec[];
  /**
   * Font catalogues the document loads families it names from, in addition
   * to the engine's (`initialize.fontCatalogues`), as plugins'
   * `engine.fontCatalogues` do (PLAN §6.4). The fonts they load are the
   * worker's. Fixed for the document's lifetime. @beta
   */
  fontCatalogues?: FontCatalogue[];
  /** Passed to `createHealer`. Use `finish()` rather than `final`. */
  heal?: HealOptions;
  /**
   * Plugins (PLAN §8.0) whose engine and heal facets apply to the document:
   * their files, packages and preambles (before `preamble`), heal handlers and
   * lint settings, and fixer modules and font catalogues, which the worker
   * loads for this document. Fonts are the worker's: a plugin's `engine.fonts`
   * load only from `createEngine`'s `plugins`. Fixed for the document's lifetime.
   */
  plugins?: readonly TypstreamPlugin[];
  /** Overrides the engine's schedule for this document. */
  schedule?: Partial<ScheduleOptions>;
  /**
   * Layer 4 (PLAN §5.6): when the source fails to compile even after the
   * worker's fixes, show failing top-level blocks as error boxes, after
   * `schedule.staleMs` the unsettled tail as plain text, and in final mode
   * find and skip what hangs or crashes the engine. Default true; false
   * keeps the last good artifact instead.
   */
  fallback?: boolean;
}

/**
 * A document being streamed or edited. Feed it input; it heals, compiles in the
 * engine's worker and publishes {@link DocumentState}s. Calls after `dispose()`
 * are ignored.
 * @public
 */
export interface EngineDocument {
  /** Names the document in the worker; unique among the engine's open documents. */
  readonly uri: DocumentUri;
  /**
   * Its plugins as they load (`resolvePlugins` from `@typstream/core`): each
   * key once, dependencies first. Renderers apply their facets in this order.
   */
  readonly plugins: readonly TypstreamPlugin[];
  /** Appends streamed text. */
  push(chunk: string): void;
  /** Replaces the whole input (a growing `source` prop, a regenerated answer). */
  set(input: string): void;
  /** Edits the input (editors, AI rewrites of a section). */
  applyEdit(edit: TextEdit): void;
  /**
   * The input is complete: heal it strictly (no tail repair) and compile it in
   * final mode, right away and even if live compiling stopped. Status becomes
   * `done` or `error`. Later edits still compile, in final mode.
   */
  finish(): void;
  /** Starts over with `input` (default empty) in streaming mode, forgetting watchdog strikes. */
  reset(input?: string): void;
  /** Compiles to `target` from now on. The artifact of the other target stays until the first new one. */
  setTarget(target: CompileTarget): void;
  /** Replaces `sys.inputs` and recompiles if they changed. */
  setInputs(inputs: Record<string, string>): void;
  /** Writes (or, with `null`, deletes) files the document reads. */
  setFiles(files: FileDelta): void;
  /**
   * Exports the document as PDF: {@link EngineDocument.exportSource}'s source,
   * compiled in final mode with the document's preamble and files, by the
   * same engine as the preview (PLAN §6.5). Exports run before compiles that
   * are waiting, under the final watchdog budget. Call `finish()` first to
   * export the finished document. Rejects with an {@link ExportError}.
   */
  exportPdf(options?: ExportOptions): Promise<Uint8Array>;
  /**
   * Exports the document as Typst's HTML, without source anchors: a complete,
   * unsanitized HTML document. `@typstream/dom`'s `standaloneHtml` makes it a
   * file that opens on its own. Otherwise as {@link EngineDocument.exportPdf}.
   */
  exportHtml(options?: ExportOptions): Promise<string>;
  /**
   * The source the exports compile: the healed input (lint fixes, and tail
   * repair until `finish()`), without the preamble or files.
   */
  exportSource(): string;
  /** The current state; the same object until something changes. */
  getState(): DocumentState;
  /** Calls `listener` with every new state; returns the unsubscribe function. */
  subscribe(listener: (state: DocumentState) => void): () => void;
  /**
   * Calls `listener` with every `DocumentEvent` (`@typstream/core`), for logging and
   * telemetry (PLAN §8.6); returns the unsubscribe function. A compile's
   * events fire before the state it leads to is published.
   */
  onEvent(listener: (event: DocumentEvent) => void): () => void;
  /**
   * Stops scheduling, cancels the compile in flight (its output is dropped)
   * and closes the document in the worker.
   */
  dispose(): void;
}

/**
 * How to export a document.
 * @public
 */
export interface ExportOptions {
  /**
   * `sys.inputs` for the export. Default: the document's. Leave out layout
   * inputs, such as a fit-width preview's page size, to export at the
   * document's own page size.
   */
  inputs?: Record<string, string>;
}

/**
 * Why an export failed:
 *
 * - `diagnostics`: the source has errors (they are in `diagnostics`).
 * - `unsupported`: the engine doesn't offer this format (see `initialize`'s
 *   `capabilities.exports` in `engine.ready`).
 * - `timeout`: the export ran past the final watchdog budget; the worker was replaced.
 * - `crash`: the worker died during the export.
 * - `too-large`: the input is longer than `limits.maxLength`.
 * - `engine`: the engine can't run, was disposed, or refused the request; or
 *   the document was disposed.
 * @public
 */
export class ExportError extends Error {
  /** Always `"ExportError"`. */
  override readonly name = "ExportError";
  /** What went wrong, for choosing what to show. */
  readonly reason: "diagnostics" | "unsupported" | "timeout" | "crash" | "too-large" | "engine";
  /** The export's diagnostics in input coordinates, sorted; with `diagnostics`, at least one error. */
  readonly diagnostics: Diagnostic[];

  /** @internal */
  constructor(reason: ExportError["reason"], message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

/** Watchdog limits (PLAN §6.3). @public */
export interface WatchdogOptions {
  /** Budget of a streaming compile. Default 3000 ms. */
  streamingMs: number;
  /** Budget of a final compile. Default 10000 ms. */
  finalMs: number;
  /** Timeouts or crashes after which a document stops compiling live. Default 3. */
  strikes: number;
  /**
   * Budget of each compile that looks for the part of a finished document
   * that hangs or crashes the engine (PLAN §5.6): prefixes of it, the rest
   * skipped. Default 5000 ms.
   */
  probeMs: number;
}

/**
 * What a document may cost (PLAN §9). Hostile or runaway input stops here
 * instead of loading the main thread (healing) or the page (pages).
 * @public
 */
export interface LimitOptions {
  /**
   * The longest input, in UTF-16 code units, that is healed and compiled.
   * Longer input fails with `too-large`: pushes and edits are dropped until
   * `set()` or `reset()` brings it back under the limit. Default 1 MiB
   * (1,048,576).
   */
  maxLength: number;
  /**
   * The most pages a streaming paged compile may have. One with more stops
   * live compiling (`too-complex`), keeping its pages; the finished document
   * compiles in full. Default 100.
   */
  livePages: number;
}

/** @internal What a document needs from the engine. */
export interface DocumentHost {
  readonly clock: Clock;
  readonly watchdog: WatchdogOptions;
  readonly limits: LimitOptions;
  /** Counts worker replacements; a document opened in an older generation must be opened again. */
  readonly generation: number;
  /** Set when the engine can't run at all. */
  readonly broken: Error | null;
  enqueue(doc: DocumentImpl): void;
  /** Sends `document/close` to the active worker. */
  close(uri: DocumentUri, rev: Revision): void;
  /** A document's event, for the engine's listeners. */
  report(event: DocumentEvent): void;
  /** Forgets a disposed document, cancelling its compile in flight and its queued exports. */
  release(doc: DocumentImpl, inFlight: RequestId | null): void;
  /** Queues an export, or rejects it right away if the engine can't run. */
  export(job: ExportJob): void;
}

/** @internal An export waiting for its turn in the engine. */
export interface ExportJob {
  doc: DocumentImpl;
  format: ExportFormat;
  inputs: Record<string, string> | undefined;
  resolve(data: Uint8Array | string): void;
  reject(error: ExportError): void;
}

/** @internal What the worker holds of a document: its revision, and the healing that made it. */
export interface Synced {
  rev: Revision;
  heal: HealResult;
  /** The input `heal` healed. */
  input: string;
}

/** @internal A compile the engine is about to send. */
export interface CompileJob {
  params: CompileParams;
  budgetMs: number;
}

/** @internal */
export type CompileOutcome = { result: CompileResult } | { error: unknown };

// Answers meaning the worker's copy of the document isn't what the client
// thinks it is: open it afresh before the next compile.
const DESYNC = new Set(["document-not-open", "document-already-open", "stale-revision", "content-modified"]);

/** Patches counted by reason. */
const patchReasons = (heal: HealResult): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const p of heal.patches) counts[p.reason] = (counts[p.reason] ?? 0) + 1;
  return counts;
};

const sameInputs = (a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean => {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b ?? {}).length && ka.every((k) => a?.[k] === b?.[k]);
};

/** @internal */
export class DocumentImpl implements EngineDocument {
  readonly uri: DocumentUri;
  readonly plugins: readonly TypstreamPlugin[];
  private readonly host: DocumentHost;
  private readonly schedule: ScheduleOptions;
  private readonly healer: Healer;
  private readonly preamble: string | undefined;
  private readonly fallback: boolean;
  private readonly packages: PackageSpec[] | undefined;
  private readonly fixerModules: string[] | undefined;
  private readonly fontCatalogues: FontCatalogue[] | undefined;
  private healed: HealResult;
  private target: CompileTarget;
  private inputs: Record<string, string> | undefined;
  private files: FileDelta;
  private pendingFiles: FileDelta | null = null;
  /** Images asked of `resolveImage`, if there is one. */
  private readonly images: DocumentImages | null;
  /** Diagnostics as the worker sent them, in input coordinates, before `images` describes them. */
  private received: Diagnostic[] = [];

  // What the worker has: the document is open there in `openedIn` (a worker
  // generation) with text `sentSource` at revision `sent.rev`.
  private rev: Revision = 0;
  private openedIn = -1;
  private sentSource = "";
  private sent: Synced | null = null;

  // Scheduling. "Latest wins": at most one compile in flight, and at most one
  // pending, which is just this flag; the source is read when the compile starts.
  private needsCompile = false;
  private urgent = false;
  private fullPages = false;
  private timer: unknown = null;
  private timerDue = 0;
  private queued = false;
  private inFlight: RequestId | null = null;
  private compiling = false;
  private lastStart = Number.NEGATIVE_INFINITY;
  private stableAtLastCompile = 0;
  private ema: number | null = null;
  /** Main-thread healing since the last compile started, ms. */
  private healMs = 0;
  /** The compile in flight: its mode, budget and healing time (for its events). */
  private job: { mode: CompileMode; budgetMs: number; healMs: number } | null = null;
  /** Diagnostics arrived for the compile in flight. */
  private reported = false;
  /** Compiles in a row whose output wasn't the text as it is. */
  private fallbacks = 0;

  private final = false;
  private live = true;
  private strikes = 0;
  /** The input is longer than `limits.maxLength`: its length, while it is. */
  private tooLong: number | null = null;
  /** Since when streaming compiles have failed (clock time), or `null` while the artifact is current. */
  private staleSince: number | null = null;
  /** Final mode: the search for what hangs the source (PLAN §5.6), while it runs and after. */
  private hang: HangSearch | null = null;
  /** The compile in flight only probes for a hang; its output isn't the document's. */
  private probing = false;
  private artifact: Artifact | null = null;
  private artifactRev: Revision | null = null;
  private diagnostics: Diagnostic[] = [];
  private failure: CompileFailure | null = null;
  private lastCompile: CompileResult | null = null;
  private state: DocumentState;
  private readonly listeners = new Set<(state: DocumentState) => void>();
  private readonly eventListeners = new Set<(event: DocumentEvent) => void>();
  private disposed = false;

  constructor(uri: DocumentUri, host: DocumentHost, schedule: ScheduleOptions, options: ResolvedDocumentOptions) {
    this.uri = uri;
    this.plugins = options.plugins ?? [];
    this.host = host;
    this.schedule = schedule;
    this.healer = createHealer({ ...options.heal, final: false });
    this.healed =
      options.text && this.fits(options.text.length)
        ? this.heal(() => this.healer.set(options.text as string))
        : this.healer.result();
    this.target = options.target ?? "html";
    this.inputs = options.inputs;
    this.preamble = options.preamble;
    this.fallback = options.fallback !== false;
    this.packages = options.packages;
    this.fixerModules = options.fixerModules;
    this.fontCatalogues = options.fontCatalogues;
    this.files = { ...options.files };
    this.images = options.resolveImage
      ? new DocumentImages(options.resolveImage, {
          has: (key) => Object.keys(this.files).some((path) => fileKey(path) === key),
          loaded: (key, bytes) => this.setFiles({ [key]: bytes }),
          changed: () => {
            this.diagnostics = this.describe(this.received);
            this.emit();
          },
        })
      : null;
    this.images?.scan(this.healer.input);
    this.state = this.snapshot();
    this.scheduleCompile();
  }

  // -------------------------------------------------------------------------
  // input

  push(chunk: string): void {
    if (this.disposed || this.tooLong !== null) return;
    if (this.fits(this.healer.input.length + chunk.length)) this.changed(this.heal(() => this.healer.push(chunk)));
    else this.update();
  }

  set(input: string): void {
    if (this.disposed) return;
    if (this.fits(input.length)) this.changed(this.heal(() => this.healer.set(input)));
    else this.update();
  }

  applyEdit(edit: TextEdit): void {
    if (this.disposed || this.tooLong !== null) return;
    if (this.fits(this.healer.input.length - (edit.to - edit.from) + edit.insert.length)) {
      this.changed(this.heal(() => this.healer.applyEdit(edit)));
    } else this.update();
  }

  /**
   * Whether input of this length is within `limits.maxLength`. Past it, the
   * healer keeps the last input that fit and nothing compiles: the length
   * stays recorded until `set()` or `reset()` brings it back, since the text
   * dropped meanwhile makes later pushes and edits meaningless.
   */
  private fits(length: number): boolean {
    this.tooLong = length > this.host.limits.maxLength ? length : null;
    return this.tooLong === null;
  }

  finish(): void {
    if (this.disposed) return;
    this.final = true;
    this.urgent = true;
    this.needsCompile = true;
    this.changed(this.heal(() => this.healer.finish()));
  }

  reset(input = ""): void {
    if (this.disposed) return;
    const kept = this.fits(input.length) ? input : "";
    this.heal(() => this.healer.reset(kept));
    this.final = false;
    this.fallbacks = 0;
    this.live = true;
    this.strikes = 0;
    this.staleSince = null;
    this.hang = null;
    this.urgent = false;
    this.failure = null;
    this.needsCompile = true;
    this.changed(this.healer.result());
  }

  setTarget(target: CompileTarget): void {
    if (this.disposed || target === this.target) return;
    this.target = target;
    this.received = [];
    this.diagnostics = [];
    this.needsCompile = true;
    this.update();
  }

  setInputs(inputs: Record<string, string>): void {
    if (this.disposed || sameInputs(inputs, this.inputs)) return;
    this.inputs = { ...inputs };
    this.needsCompile = true;
    this.update();
  }

  setFiles(files: FileDelta): void {
    if (this.disposed) return;
    for (const [path, content] of Object.entries(files)) {
      if (content === null) delete this.files[path];
      else this.files[path] = content;
    }
    this.pendingFiles = { ...this.pendingFiles, ...files };
    this.needsCompile = true;
    this.update();
  }

  exportPdf(options?: ExportOptions): Promise<Uint8Array> {
    return this.export("pdf", options) as Promise<Uint8Array>;
  }

  exportHtml(options?: ExportOptions): Promise<string> {
    return this.export("html", options) as Promise<string>;
  }

  exportSource(): string {
    return this.healed.source;
  }

  private export(format: ExportFormat, options: ExportOptions = {}): Promise<Uint8Array | string> {
    return new Promise((resolve, reject) => {
      if (this.disposed) reject(new ExportError("engine", "The document was disposed."));
      else if (this.tooLong !== null) reject(new ExportError("too-large", this.tooLargeMessage()));
      else this.host.export({ doc: this, format, inputs: options.inputs ?? this.inputs, resolve, reject });
    });
  }

  getState(): DocumentState {
    return this.state;
  }

  subscribe(listener: (state: DocumentState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (event: DocumentEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.images?.dispose();
    this.clearTimer();
    this.listeners.clear();
    this.eventListeners.clear();
    this.host.release(this, this.inFlight);
    if (this.openedIn === this.host.generation) this.host.close(this.uri, this.rev);
  }

  /** Runs a healer call, timing it for the next compile's events. */
  private heal<T>(run: () => T): T {
    const start = performance.now();
    try {
      return run();
    } finally {
      this.healMs += performance.now() - start;
    }
  }

  /** Diagnostics of images that are loading or failed to, said so (`resolveImage`). */
  private describe(diagnostics: Diagnostic[]): Diagnostic[] {
    return this.images ? this.images.describe(diagnostics, this.healer.input) : diagnostics;
  }

  private changed(healed: HealResult): void {
    this.healed = healed;
    this.images?.scan(this.healer.input);
    this.update();
  }

  /** After any change: schedule a compile if one is due, and publish the new state. */
  private update(): void {
    this.scheduleCompile();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // scheduling

  private wantsCompile(): boolean {
    return (
      !this.disposed &&
      !this.host.broken &&
      this.tooLong === null &&
      (this.live || this.final) &&
      (this.needsCompile || this.healed.source !== this.sentSource)
    );
  }

  private scheduleCompile(): void {
    if (this.queued || this.compiling || !this.wantsCompile()) return;
    const now = this.host.clock.now();
    const boundary = this.schedule.boundaryBias && this.healed.stableOffset > this.stableAtLastCompile;
    const interval = this.urgent ? 0 : boundary ? this.schedule.minInterval : compileInterval(this.ema, this.schedule);
    const due = Math.max(now, this.lastStart + interval);
    if (this.timer !== null) {
      if (this.timerDue <= due) return;
      this.clearTimer();
    }
    this.timerDue = due;
    // Even when due now, wait for a timer: chunks pushed in the same task then
    // share one compile.
    this.timer = this.host.clock.setTimeout(() => {
      this.timer = null;
      this.queued = true;
      this.host.enqueue(this);
    }, due - now);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.host.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  // -------------------------------------------------------------------------
  // compiling (called by the engine)

  /**
   * The engine's turn for this document: bring the worker's copy up to date and
   * describe the compile, or return `null` if there's nothing to compile any more.
   */
  prepare(conn: Connection, generation: number): CompileJob | null {
    this.queued = false;
    if (!this.wantsCompile()) {
      this.emit();
      return null;
    }
    const { rev, heal } = this.sync(conn, generation);
    this.needsCompile = false;
    this.urgent = false;
    this.compiling = true;
    this.lastStart = this.host.clock.now();
    this.stableAtLastCompile = heal.stableOffset;
    const params: CompileParams = { uri: this.uri, rev, target: this.target, mode: this.final ? "final" : "streaming" };
    if (this.inputs) params.inputs = this.inputs;
    // The worker's fixers may cut what is still being typed (PLAN §5.5), never the settled text.
    if (!this.final) params.settled = heal.stableOffset;
    if (this.fullPages) params.fullPages = true;
    this.fullPages = false;
    const { watchdog } = this.host;
    let budgetMs = this.final ? watchdog.finalMs : watchdog.streamingMs;
    this.probing = false;
    if (this.fallback) params.fallback = this.fallbackParams(heal);
    if (this.hang?.probing) {
      this.probing = true;
      budgetMs = watchdog.probeMs;
    }
    this.job = { mode: params.mode as CompileMode, budgetMs, healMs: this.healMs };
    this.healMs = 0;
    this.reported = false;
    this.emit();
    return { params, budgetMs };
  }

  /** Layer 4 of the next compile (PLAN §5.6). */
  private fallbackParams(heal: HealResult): FallbackParams {
    const fallback: FallbackParams = { isolate: true };
    const since = this.staleSince;
    if (!this.final && since !== null && this.host.clock.now() - since >= this.schedule.staleMs) {
      fallback.stablePrefix = true;
    }
    // What hangs a finished source stays skipped while it is the source.
    if (this.hang && this.hang.text !== heal.source) this.hang = null;
    const skip = this.hang?.skip();
    if (skip?.length) fallback.skip = skip;
    return fallback;
  }

  /** Brings the worker's copy of the document up to the healed source. */
  private sync(conn: Connection, generation: number): Synced {
    const heal = this.healed;
    const source = heal.source;
    const { uri } = this;
    if (this.openedIn !== generation) {
      // A fresh worker (startup, watchdog, recycling) or a desync: open with everything.
      this.rev++;
      conn.send("document/open", {
        uri,
        rev: this.rev,
        text: source,
        preamble: this.preamble,
        files: this.files,
        packages: this.packages,
        fixerModules: this.fixerModules,
        fontCatalogues: this.fontCatalogues,
      });
      this.openedIn = generation;
      this.pendingFiles = null;
    } else {
      if (this.pendingFiles) {
        this.rev++;
        conn.send("document/setFiles", { uri, rev: this.rev, files: this.pendingFiles });
        this.pendingFiles = null;
      }
      const edit = diffEdit(this.sentSource, source);
      if (edit) {
        this.rev++;
        conn.send("document/edit", { uri, rev: this.rev, edits: [edit] });
      }
    }
    this.sentSource = source;
    this.sent = { rev: this.rev, heal, input: this.healer.input };
    return this.sent;
  }

  /**
   * The engine's turn for an export of this document: bring the worker's copy
   * up to date, or return `null` if the document was disposed.
   */
  prepareExport(conn: Connection, generation: number): Synced | null {
    if (this.disposed) return null;
    const rev = this.rev;
    const synced = this.sync(conn, generation);
    // The worker now has a source the preview hasn't compiled: compile it too.
    if (synced.rev !== rev) {
      this.needsCompile = true;
      this.update();
    }
    return synced;
  }

  /** The export `prepareExport` synced for is over. */
  settleExport(
    job: ExportJob,
    synced: Synced,
    outcome: { result: ExportResult<Uint8Array | string> } | { error: unknown },
  ): void {
    if ("result" in outcome) {
      const r = outcome.result;
      if (r.status === "ok") {
        job.resolve(r.data);
        return;
      }
      const toInput = (pos: number, assoc: 1 | -1) => synced.heal.map.toInput(pos, assoc);
      const diagnostics = normalizeDiagnostics(r.diagnostics.map((d) => mapDiagnostic(d, toInput)));
      const message = diagnostics.find(isError)?.message ?? "The document has errors.";
      job.reject(new ExportError("diagnostics", message, diagnostics));
      return;
    }
    const e = outcome.error;
    if (e instanceof WorkerGone && e.reason === "timeout") {
      job.reject(new ExportError("timeout", `Exporting took longer than ${this.host.watchdog.finalMs} ms.`));
    } else if (e instanceof WorkerGone && e.reason === "crash") {
      job.reject(new ExportError("crash", "The engine crashed while exporting."));
    } else if (e instanceof ProtocolError && e.code === "unsupported") {
      job.reject(new ExportError("unsupported", e.message));
    } else {
      if (e instanceof ProtocolError && DESYNC.has(e.code)) this.desync();
      job.reject(new ExportError("engine", e instanceof Error ? e.message : String(e)));
    }
  }

  started(id: RequestId): void {
    this.inFlight = id;
  }

  /** Output the worker published for this document. */
  receive(n: ServerNotification<"document/diagnostics" | "document/artifact">): void {
    // Only output of the revision last sent counts: anything else is older
    // than what the worker now has, and its positions don't match `sent.heal`.
    if (this.disposed || !this.sent || n.params.rev !== this.sent.rev) return;
    // A probe for a hang compiles a prefix of the document, with the rest skipped.
    if (this.probing && this.compiling) return;
    const { rev, heal } = this.sent;
    if (n.method === "document/diagnostics") {
      if (n.params.target !== this.target) return;
      const toInput = (pos: number, assoc: 1 | -1) => heal.map.toInput(pos, assoc);
      this.received = normalizeDiagnostics(n.params.diagnostics.map((d) => mapDiagnostic(d, toInput)));
      this.diagnostics = this.describe(this.received);
      // A compile's diagnostics are reported with its other events, in `settle`.
      if (this.compiling) this.reported = true;
      else this.report(this.diagnosticsEvent(rev, this.final ? "final" : "streaming"));
    } else {
      const { artifact } = n.params;
      if (artifact.target !== this.target) return;
      if (artifact.target === "paged") {
        const prev = this.artifact?.target === "paged" ? this.artifact : null;
        const pages = applyPaged(prev, this.artifactRev, artifact);
        if (!pages) {
          // It diffs against pages we don't have: ask for all of them.
          this.fullPages = true;
          this.needsCompile = true;
          this.update();
          return;
        }
        this.artifact = pages;
      } else {
        this.artifact = artifact;
      }
      this.artifactRev = rev;
    }
    // During a compile, `settle` publishes once for all of its output; output
    // the server sends on its own (a font arrived) is published now.
    if (!this.compiling) this.update();
  }

  /** The compile `prepare` described is over. */
  settle(outcome: CompileOutcome): void {
    const probing = this.probing;
    const job = this.job;
    this.compiling = false;
    this.probing = false;
    this.inFlight = null;
    this.job = null;
    if (this.disposed) return;
    if ("result" in outcome) {
      const r = outcome.result;
      if (probing || (this.hang && !this.hang.done)) {
        // A compile of the hang search finished: on to the next one, unless that was the last.
        this.hang?.answer(null);
        if (probing || !this.hang?.done) {
          this.needsCompile = true;
          this.urgent = true;
          this.update();
          return;
        }
      }
      this.lastCompile = r;
      this.ema = updateEma(this.ema, r.timings.totalMs);
      this.failure =
        r.status === "ok"
          ? null
          : {
              reason: "diagnostics",
              message: this.diagnostics.find(isError)?.message ?? "The document has errors.",
            };
      if (r.status === "ok" && r.fallback?.plainFrom == null) this.staleSince = null;
      else if (r.status !== "ok" && !this.final) this.staleSince ??= this.host.clock.now();
      const pages = this.artifact?.target === "paged" ? this.artifact.pages.length : 0;
      if (!this.final && this.artifactRev === this.sent?.rev && pages > this.host.limits.livePages) {
        // Laying out and drawing more pages costs more on every compile.
        this.stopLive(
          `This document has more than ${this.host.limits.livePages} pages, too many to preview live. ` +
            "It will compile once it is finished.",
        );
      }
      if (job) this.reportCompile(r, job);
    } else {
      const e = outcome.error;
      if (e instanceof WorkerGone && (e.reason === "timeout" || e.reason === "crash")) {
        if (!this.final) this.staleSince ??= this.host.clock.now();
        const searching = this.searchHang(e.reason);
        if (searching) {
          this.needsCompile = true;
          this.urgent = true;
        } else this.strike(e.reason);
        if (job && this.sent) {
          const { rev, heal } = this.sent;
          this.report({
            type: "watchdog",
            uri: this.uri,
            rev,
            target: this.target,
            mode: job.mode,
            reason: e.reason,
            budgetMs: job.budgetMs,
            strikes: this.strikes,
            live: this.live,
            searching,
            sourceLength: heal.source.length,
          });
        }
      } else if (e instanceof WorkerGone) {
        // Recycled, replaced or disconnected under it: the retry reports the healing that led to it.
        this.needsCompile = true;
        if (job) this.healMs += job.healMs;
      } else if (!(e instanceof ProtocolError && e.code === "request-cancelled")) {
        this.failure = { reason: "engine", message: e instanceof Error ? e.message : String(e) };
        if (e instanceof ProtocolError && DESYNC.has(e.code)) this.desync();
      }
    }
    this.update();
  }

  /**
   * A final compile ran out of time or crashed: look for the blocks that do
   * it, or go on looking. False when there's no search to run (streaming, the
   * fallback is off, or the search gave up).
   */
  private searchHang(reason: "timeout" | "crash"): boolean {
    if (!this.final || !this.fallback || !this.sent) return false;
    const text = this.sent.heal.source;
    if (this.hang?.text === text && !this.hang.done) {
      if (this.hang.answer(reason)) return true;
    } else if (!this.hang || this.hang.text !== text) {
      this.hang = new HangSearch(text, reason);
      return true;
    }
    return false;
  }

  private strike(reason: "timeout" | "crash"): void {
    this.strikes++;
    const budget = this.final ? this.host.watchdog.finalMs : this.host.watchdog.streamingMs;
    const message =
      reason === "timeout" ? `Compiling took longer than ${budget} ms.` : "The engine crashed while compiling.";
    if (!this.final && this.strikes >= this.host.watchdog.strikes) {
      this.stopLive("This document is too complex to preview live. It will compile once it is finished.");
    } else {
      this.failure = { reason, message };
    }
  }

  /** Stops live compiling until `finish()` (or `reset()`). */
  private stopLive(message: string): void {
    this.live = false;
    this.clearTimer();
    this.failure = { reason: "too-complex", message };
  }

  private tooLargeMessage(): string {
    return `This document is too long to preview: ${this.tooLong} characters, more than ${this.host.limits.maxLength}.`;
  }

  /** The failure to show: an input too long to compile wins over the last compile's. */
  private currentFailure(): CompileFailure | null {
    if (this.tooLong === null) return this.failure;
    return { reason: "too-large", message: this.tooLargeMessage() };
  }

  /** The worker's copy can't be trusted: close it and open it afresh at the next compile. */
  private desync(): void {
    if (this.openedIn === this.host.generation) this.host.close(this.uri, this.rev);
    this.openedIn = -1;
  }

  // -------------------------------------------------------------------------
  // events

  private report(event: DocumentEvent): void {
    for (const listener of this.eventListeners) listener(event);
    this.host.report(event);
  }

  private diagnosticsEvent(rev: Revision, mode: CompileMode): DocumentEvent {
    return { type: "diagnostics", uri: this.uri, rev, target: this.target, mode, diagnostics: this.diagnostics };
  }

  /** A compile's events: its diagnostics, what it cost and made, and the fallback if it fell back. */
  private reportCompile(r: CompileResult, job: { mode: CompileMode; healMs: number }): void {
    if (!this.sent || r.rev !== this.sent.rev) return;
    const { rev, heal, input } = this.sent;
    const { mode } = job;
    const base = { uri: this.uri, rev, target: this.target, mode };
    if (this.reported) this.report(this.diagnosticsEvent(rev, mode));
    const level: FallbackLevel = r.status === "ok" ? (r.fallback?.level ?? 0) : 1;
    const compiled: CompiledEvent = {
      type: "compiled",
      ...base,
      status: r.status,
      timings: r.timings,
      compileMs: r.timings.compileMs ?? 0,
      healMs: job.healMs,
      patches: heal.patches.length,
      patchReasons: patchReasons(heal),
      fixersApplied: r.fixes ?? [],
      fallbackLevel: level,
      errors: this.diagnostics.filter(isError).length,
      warnings: this.diagnostics.filter((d) => d.severity === "warning").length,
      sourceLength: heal.source.length,
    };
    if (r.status === "ok" && this.artifact?.target === "paged" && this.artifactRev === rev) {
      compiled.pages = this.artifact.pageCount;
    }
    this.report(compiled);
    if (level === 0) {
      this.fallbacks = 0;
      return;
    }
    this.fallbacks++;
    this.report({
      type: "fallback",
      ...base,
      level,
      isolated: r.fallback?.isolated ?? [],
      plainFrom: r.fallback?.plainFrom ?? null,
      consecutive: this.fallbacks,
      diagnostics: this.diagnostics,
      input,
      source: heal.source,
    });
  }

  /** The engine can't run (it failed to start, or a replacement worker did). */
  engineFailed(error: Error): void {
    if (this.disposed) return;
    this.clearTimer();
    this.queued = false;
    this.failure = { reason: "engine", message: error.message };
    this.emit();
  }

  // -------------------------------------------------------------------------
  // state

  private status(failure: CompileFailure | null): DocumentStatus {
    if (this.host.broken) return "error";
    if (failure && !this.final) return "stale";
    if (this.compiling || this.queued || this.timer !== null || this.wantsCompile()) return "compiling";
    if (failure) return "error";
    return this.final ? "done" : "idle";
  }

  private snapshot(): DocumentState {
    const failure = this.currentFailure();
    return {
      status: this.status(failure),
      artifact: this.artifact,
      artifactRev: this.artifactRev,
      diagnostics: this.diagnostics,
      heal: this.healed,
      final: this.final,
      live: this.live,
      failure,
      lastCompile: this.lastCompile,
    };
  }

  private emit(): void {
    if (this.disposed) return;
    this.state = this.snapshot();
    for (const listener of this.listeners) listener(this.state);
  }
}
