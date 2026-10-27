// The main-thread client (PLAN §4, §6.2–6.3): owns the worker, runs one compile
// at a time for all of its documents, and replaces the worker when a compile
// runs past its budget (watchdog), the worker crashes, or its memory grows past
// a threshold (recycling). A pre-warmed spare makes a replacement immediate.
// Over a socket, a dropped connection is replaced too, and what it was running
// retried.

import {
  type DocumentEvent,
  type DocumentUri,
  type ExportParams,
  type ExportResult,
  type InitializeOptions,
  type InitializeResult,
  PROTOCOL_VERSION,
  type RequestId,
  type Revision,
  type ServerNotification,
  type TypstreamPlugin,
} from "@typstream/core";
import { type Clock, systemClock } from "./clock";
import { Connection, type GoneReason, type SpawnEngine, WorkerGone } from "./connection";
import {
  type CompileOutcome,
  type DocumentHost,
  DocumentImpl,
  type DocumentOptions,
  type EngineDocument,
  ExportError,
  type ExportJob,
  type LimitOptions,
  type WatchdogOptions,
} from "./document";
import { documentOptions, initializeOptions } from "./plugins";
import { DEFAULT_SCHEDULE, type ScheduleOptions } from "./schedule";

/**
 * How to run the engine.
 * @public
 */
export interface EngineOptions {
  /**
   * Starts a worker running the engine server: {@link engineWorker} in a
   * browser, or `fromWebSocket` (`@typstream/engine/websocket`) for a server.
   */
  spawn: SpawnEngine;
  /** Fonts and packages shared by every document, sent with `initialize`. @beta */
  initialize?: InitializeOptions;
  /**
   * Plugins whose worker-wide facets the engine loads (PLAN §8.0): their
   * `engine.fonts`, `engine.packages` and `engine.fixerModules` join
   * `initialize`'s. Their document facets (files, preamble, heal) apply to the
   * documents that list them in {@link DocumentOptions.plugins}.
   */
  plugins?: readonly TypstreamPlugin[];
  /** Sent with `initialize`, for the worker's logs. */
  clientInfo?: { name: string; version?: string };
  /** Compile budgets and strikes; defaults in {@link DEFAULT_WATCHDOG}, or the `spawn`'s own. */
  watchdog?: Partial<WatchdogOptions>;
  /** Input length and live page limits; defaults in {@link DEFAULT_LIMITS}. */
  limits?: Partial<LimitOptions>;
  /**
   * Replace the worker once it reports more memory than this after a compile.
   * A safety net: the default engine evicts Typst's caches after every compile
   * and stays flat. Default 256 MiB; `Infinity` disables recycling.
   */
  recycleBytes?: number;
  /** Keep an initialized spare worker so replacing the active one is instant. Default true, or the `spawn`'s own. */
  spare?: boolean;
  /** Default schedule of every document. */
  schedule?: Partial<ScheduleOptions>;
  /** Timers; tests pass fake ones. */
  clock?: Clock;
}

/**
 * Something the engine did, for logging and telemetry (PLAN §8.6). The library
 * sends nothing anywhere itself.
 *
 * - `ready`: a worker finished `initialize` (the first one and every replacement).
 * - `watchdog`: a compile or export ran past its budget; the worker was terminated.
 * - `crash`: a worker failed outside the protocol.
 * - `disconnect`: the connection to the engine dropped (a WebSocket closed);
 *   a new one opens.
 * - `recycle`: a worker was replaced because it used too much memory.
 * - `log`: a `$/log` message from the worker.
 * - `failed`: the engine can't run; every document is in `error`.
 * - `document`: an event of one of the engine's documents (see
 *   `EngineDocument.onEvent`), so one listener can collect them all.
 * @public
 */
export type EngineEvent =
  | { type: "ready"; info: InitializeResult }
  | { type: "watchdog"; uri: DocumentUri; rev: Revision; budgetMs: number }
  | { type: "crash"; error: unknown }
  | { type: "disconnect"; error: unknown }
  | { type: "recycle"; memoryBytes: number }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
  | { type: "failed"; error: Error }
  | { type: "document"; event: DocumentEvent };

/**
 * The main-thread engine client. Create one per page (or per app) and open a
 * document per rendered Typst source; documents share the worker.
 * @public
 */
export interface Engine {
  /** Opens a document. Throws if `options.uri` is already open. */
  open(options?: DocumentOptions): EngineDocument;
  /** The first worker's `initialize` answer. Rejects if the engine can't start. */
  readonly ready: Promise<InitializeResult>;
  /** Calls `listener` with every {@link EngineEvent}; returns the unsubscribe function. */
  onEvent(listener: (event: EngineEvent) => void): () => void;
  /** Disposes every document and terminates the workers. */
  dispose(): void;
}

/**
 * 3 s per streaming compile, 10 s per final compile, live compiling stops after
 * 3 strikes; 5 s per compile looking for what hangs a finished document.
 * @public
 */
export const DEFAULT_WATCHDOG: Readonly<WatchdogOptions> = {
  streamingMs: 3000,
  finalMs: 10_000,
  strikes: 3,
  probeMs: 5000,
};

/** Inputs up to 1 MiB (UTF-16 code units); live preview up to 100 pages. @public */
export const DEFAULT_LIMITS: Readonly<LimitOptions> = {
  maxLength: 1024 * 1024,
  livePages: 100,
};

/** 256 MiB of engine memory, past which the worker is replaced. @public */
export const DEFAULT_RECYCLE_BYTES = 256 * 1024 * 1024;

/**
 * Creates the engine client and starts its worker.
 *
 * @example
 * ```ts
 * const engine = createEngine({ spawn: engineWorker() });
 * const doc = engine.open({ target: "html" });
 * doc.subscribe((s) => render(s.artifact, s.status));
 * for await (const chunk of llmStream) doc.push(chunk);
 * doc.finish();
 * ```
 * @public
 */
export const createEngine = (options: EngineOptions): Engine => new EngineImpl(options);

interface Slot {
  conn: Connection;
  ready: Promise<InitializeResult>;
  isReady: boolean;
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/**
 * Connections lost in a row with requests in flight, after which a loss counts
 * as a crash: something in the requests (a message over the server's size
 * limit) may be what drops them, and crashes are strikes, so it stops.
 */
const MAX_LOSSES = 3;

class EngineImpl implements Engine, DocumentHost {
  readonly clock: Clock;
  readonly watchdog: WatchdogOptions;
  readonly limits: LimitOptions;
  readonly ready: Promise<InitializeResult>;
  generation = 0;
  broken: Error | null = null;

  private readonly options: EngineOptions;
  private readonly schedule: ScheduleOptions;
  private readonly recycleBytes: number;
  private active: Slot;
  private spare: Slot | null = null;
  private readonly docs = new Map<DocumentUri, DocumentImpl>();
  /** Documents waiting for their compile, first come first served; each at most once. */
  private queue: DocumentImpl[] = [];
  /** Exports waiting for their turn. They go before compiles: someone is waiting for the file. */
  private exports: ExportJob[] = [];
  private busy = false;
  private recycleAfter: number | null = null;
  private readonly useSpare: boolean;
  /** Connections lost in a row with requests in flight; reset by an answered compile or export. */
  private losses = 0;
  private nextUri = 1;
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private disposed = false;
  private readonly initialize: InitializeOptions | undefined;
  /** Plugins already warned about for fonts the engine doesn't load. */
  private readonly fontWarnings = new Set<string>();

  constructor(options: EngineOptions) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
    const defaults = options.spawn.defaults;
    this.watchdog = { ...DEFAULT_WATCHDOG, ...defaults?.watchdog, ...options.watchdog };
    this.useSpare = (options.spare ?? defaults?.spare) !== false;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.schedule = { ...DEFAULT_SCHEDULE, ...options.schedule };
    this.recycleBytes = options.recycleBytes ?? DEFAULT_RECYCLE_BYTES;
    this.initialize = initializeOptions(options.initialize, options.plugins ?? []);
    this.active = this.spawn();
    this.ready = this.active.ready;
  }

  open(options: DocumentOptions = {}): EngineDocument {
    if (this.disposed) throw new Error("engine is disposed");
    let uri = options.uri;
    if (uri === undefined) {
      do uri = `doc-${this.nextUri++}`;
      while (this.docs.has(uri));
    } else if (this.docs.has(uri)) {
      throw new Error(`document ${uri} is already open`);
    }
    const schedule = { ...this.schedule, ...options.schedule };
    const resolved = documentOptions(options, this.initialize?.fonts ?? []);
    for (const { key } of resolved.fonts) {
      if (this.fontWarnings.has(key)) continue;
      this.fontWarnings.add(key);
      this.emit({
        type: "log",
        level: "warn",
        message: `plugin "${key}" brings fonts the engine doesn't have; pass the plugin to createEngine's plugins to load them`,
      });
    }
    const doc = new DocumentImpl(uri, this, schedule, resolved.options);
    this.docs.set(uri, doc);
    if (this.broken) doc.engineFailed(this.broken);
    return doc;
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const doc of [...this.docs.values()]) doc.dispose();
    this.disposed = true;
    this.queue = [];
    this.rejectExports(this.exports, "The engine was disposed.");
    this.active.conn.close("dispose");
    this.spare?.conn.close("dispose");
    this.spare = null;
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // DocumentHost

  enqueue(doc: DocumentImpl): void {
    if (this.disposed || this.broken) return;
    if (!this.queue.includes(doc)) this.queue.push(doc);
    void this.pump();
  }

  close(uri: DocumentUri, rev: Revision): void {
    if (!this.disposed) this.active.conn.send("document/close", { uri, rev });
  }

  report(event: DocumentEvent): void {
    if (this.listeners.size > 0) this.emit({ type: "document", event });
  }

  release(doc: DocumentImpl, inFlight: RequestId | null): void {
    this.docs.delete(doc.uri);
    this.queue = this.queue.filter((d) => d !== doc);
    this.rejectExports(
      this.exports.filter((job) => job.doc === doc),
      "The document was disposed.",
    );
    // The compile can't be interrupted once it runs, but if it's still queued
    // behind other messages the worker drops it. Either way the engine waits for
    // the answer (or the watchdog) before the next compile.
    if (inFlight !== null && !this.disposed) this.active.conn.notify("$/cancel", { id: inFlight });
  }

  export(job: ExportJob): void {
    if (this.disposed || this.broken) {
      job.reject(this.engineError("The engine was disposed."));
      return;
    }
    this.exports.push(job);
    void this.pump();
  }

  /** Why an export can't run: the engine's failure, or `otherwise`. */
  private engineError(otherwise: string): ExportError {
    return new ExportError("engine", this.broken?.message ?? otherwise);
  }

  /** Rejects `jobs` and takes them off the export queue. */
  private rejectExports(jobs: ExportJob[], message: string): void {
    const gone = new Set(jobs);
    this.exports = this.exports.filter((job) => !gone.has(job));
    for (const job of gone) job.reject(new ExportError("engine", message));
  }

  // -------------------------------------------------------------------------
  // workers

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Starts a worker and initializes it. Throws if the worker can't be created. */
  private spawn(): Slot {
    // Filled in below; the worker can't answer before `spawn` returns.
    const slot = { isReady: false } as Slot;
    const conn = new Connection(
      this.options.spawn,
      (n) => this.receive(slot, n),
      (e, lost) => this.crashed(slot, e, lost),
    );
    const ready = conn
      .request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { pagedDiff: true },
        clientInfo: this.options.clientInfo,
        options: this.initialize,
      })
      .result.then((info) => {
        if (info.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error(`engine speaks protocol ${info.protocolVersion}, client ${PROTOCOL_VERSION}`);
        }
        return info;
      });
    slot.conn = conn;
    slot.ready = ready;
    ready.then(
      (info) => {
        if (this.disposed || !conn.alive) return;
        slot.isReady = true;
        this.emit({ type: "ready", info });
        // Warm the next spare only once the active worker is up, so they don't
        // compete for the first compile.
        if (slot === this.active && this.useSpare && !this.spare) this.spare = this.trySpawn();
      },
      (e) => {
        if (slot === this.active && conn.alive) this.fail(asError(e));
        else if (slot === this.spare) this.dropSpare();
      },
    );
    return slot;
  }

  private trySpawn(): Slot | null {
    try {
      return this.spawn();
    } catch (e) {
      this.emit({ type: "crash", error: e });
      return null;
    }
  }

  private dropSpare(): void {
    this.spare?.conn.close("crash");
    this.spare = null;
  }

  private receive(slot: Slot, n: ServerNotification): void {
    if (slot !== this.active) return;
    if (n.method === "$/log") this.emit({ type: "log", ...n.params });
    else this.docs.get(n.params.uri)?.receive(n);
  }

  /** The worker failed, or (`lost`) the connection to it dropped. */
  private crashed(slot: Slot, error: unknown, lost?: boolean): void {
    this.emit({ type: lost ? "disconnect" : "crash", error });
    if (slot === this.spare) {
      this.dropSpare();
      return;
    }
    if (slot !== this.active) return;
    // A worker that dies before it is up would die again: don't respawn in a loop.
    if (!slot.isReady) {
      slot.conn.close("crash");
      this.fail(asError(error));
      return;
    }
    // A lost connection isn't the document's doing: what it was running is retried.
    this.replace(lost && !(slot.conn.busy && ++this.losses > MAX_LOSSES) ? "disconnect" : "crash");
  }

  /**
   * Terminates the active worker and promotes the spare (or starts a new one).
   * Whatever the old worker owed is rejected with `WorkerGone(reason)`, and
   * documents open themselves in the new worker before their next compile.
   */
  private replace(reason: GoneReason): void {
    const old = this.active;
    const next = this.spare ?? this.trySpawn();
    this.spare = null;
    this.generation++;
    old.conn.close(reason);
    if (!next) {
      this.fail(new Error("could not start a replacement engine worker"));
      return;
    }
    this.active = next;
    // A promoted spare is already up; start its own spare now. A new worker
    // starts its spare when it is ready (spawn).
    if (next.isReady && this.useSpare) this.spare = this.trySpawn();
  }

  private fail(error: Error): void {
    if (this.broken || this.disposed) return;
    this.broken = error;
    this.queue = [];
    this.rejectExports(this.exports, error.message);
    // Not "crash": that would count as a watchdog strike for the compile in flight.
    this.active.conn.close("dispose");
    this.dropSpare();
    this.emit({ type: "failed", error });
    for (const doc of this.docs.values()) doc.engineFailed(error);
  }

  // -------------------------------------------------------------------------
  // compiling

  /** Runs queued exports and compiles one at a time, each under the watchdog. */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        if (this.disposed || this.broken) return;
        if (this.recycleAfter !== null) this.recycle();
        const job = this.exports.shift();
        const doc = job ? undefined : this.queue.shift();
        if (!job && !doc) return;
        const slot = this.active;
        try {
          await slot.ready;
        } catch {
          // fail() already told every document, and rejected the other exports.
          job?.reject(this.engineError("The engine worker failed to start."));
          return;
        }
        if (this.disposed || this.broken) {
          job?.reject(this.engineError("The engine was disposed."));
          return;
        }
        if (slot !== this.active) {
          // Replaced while starting up: run it on the new worker instead.
          if (job) this.exports.unshift(job);
          else if (doc) this.queue.unshift(doc);
          continue;
        }
        if (job) await this.runExport(slot, job);
        else if (doc) await this.compile(slot, doc);
      }
    } finally {
      this.busy = false;
    }
  }

  /** Arms the watchdog for a request on `slot`; returns the function that disarms it. */
  private watch(slot: Slot, uri: DocumentUri, rev: Revision, budgetMs: number): () => void {
    const timer = this.clock.setTimeout(() => {
      if (slot !== this.active) return;
      this.emit({ type: "watchdog", uri, rev, budgetMs });
      this.replace("timeout");
    }, budgetMs);
    return () => this.clock.clearTimeout(timer);
  }

  private async compile(slot: Slot, doc: DocumentImpl): Promise<void> {
    const job = doc.prepare(slot.conn, this.generation);
    if (!job) return;
    const { id, result } = slot.conn.request("compile", job.params);
    doc.started(id);
    const disarm = this.watch(slot, job.params.uri, job.params.rev, job.budgetMs);
    let outcome: CompileOutcome;
    try {
      outcome = { result: await result };
      this.losses = 0;
      const bytes = outcome.result.memoryBytes;
      if (bytes !== undefined && bytes > this.recycleBytes && slot === this.active) this.recycleAfter = bytes;
    } catch (error) {
      outcome = { error };
    } finally {
      disarm();
    }
    doc.settle(outcome);
  }

  private async runExport(slot: Slot, job: ExportJob): Promise<void> {
    const synced = job.doc.prepareExport(slot.conn, this.generation);
    if (!synced) {
      job.reject(new ExportError("engine", "The document was disposed."));
      return;
    }
    const params: ExportParams = { uri: job.doc.uri, rev: synced.rev };
    if (job.inputs) params.inputs = job.inputs;
    const { result } =
      job.format === "pdf" ? slot.conn.request("export/pdf", params) : slot.conn.request("export/html", params);
    // Exports compile the whole document in final mode (PLAN §6.3).
    const disarm = this.watch(slot, params.uri, params.rev, this.watchdog.finalMs);
    let outcome: { result: ExportResult<Uint8Array | string> } | { error: unknown };
    try {
      outcome = { result: await result };
      this.losses = 0;
    } catch (error) {
      // The connection dropped: export on the next one.
      if (error instanceof WorkerGone && error.reason === "disconnect") {
        this.exports.unshift(job);
        return;
      }
      outcome = { error };
    } finally {
      disarm();
    }
    job.doc.settleExport(job, synced, outcome);
  }

  /**
   * Swaps in a fresh worker between compiles, so nothing is lost: documents
   * open themselves in it on their next compile, which runs without the old
   * worker's caches.
   */
  private recycle(): void {
    const memoryBytes = this.recycleAfter ?? 0;
    this.recycleAfter = null;
    this.emit({ type: "recycle", memoryBytes });
    this.replace("recycle");
  }
}
