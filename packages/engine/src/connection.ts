// Request/response bookkeeping over one worker (PLAN §6.1): ids, pending
// promises, notification dispatch. The worker itself is behind `SpawnEngine`,
// so the client never touches `Worker` (no DOM dependency) and tests plug in a
// fake.

import {
  type ClientMessage,
  type ClientNotificationMap,
  type ClientNotificationMethod,
  isErrorResponse,
  isResponse,
  type ParamsOf,
  ProtocolError,
  type RequestId,
  type RequestMethod,
  type ResultOf,
  type ServerMessage,
  type ServerNotification,
} from "@typstream/core";
import type { WatchdogOptions } from "./document";

/**
 * What the client hears from a worker it spawned.
 * @public
 */
export interface EngineEvents {
  /** A message the worker posted. */
  message(message: ServerMessage): void;
  /** The worker failed outside the protocol (an uncaught error, out of memory). The client replaces it. */
  error(error: unknown): void;
  /**
   * The connection dropped (a WebSocket closed): not the document's doing, so
   * unlike {@link EngineEvents.error} the compile it was running isn't a
   * watchdog strike. The client opens a new connection and retries what was
   * in flight there. Workers don't report this.
   * @beta
   */
  lost(error: unknown): void;
}

/**
 * The client's handle on one worker.
 * @public
 */
export interface EngineConnection {
  /** Posts a message to the worker (structured clone). */
  postMessage(message: ClientMessage): void;
  /** Stops the worker at once, even mid-compile. Called on watchdog timeouts, recycling and dispose. */
  terminate(): void;
}

/**
 * Starts a worker running the engine server and routes its messages and
 * errors to `events`. Called once at startup and again for every replacement
 * (watchdog, crash, recycling); each call must start a fresh worker.
 *
 * @example
 * ```ts
 * const spawn = fromWorker(() => new Worker(new URL("./engine.worker.js", import.meta.url), { type: "module" }));
 * ```
 * @public
 */
export interface SpawnEngine {
  /** Starts a fresh worker (or connection) and returns the client's handle on it. */
  (events: EngineEvents): EngineConnection;
  /**
   * What suits this transport, for the options `createEngine` isn't given:
   * `fromWebSocket` sets budgets above the server's own and no spare.
   * @beta
   */
  readonly defaults?: SpawnDefaults;
}

/**
 * Engine options a {@link SpawnEngine} suggests; `createEngine`'s own options win.
 * @beta
 */
export interface SpawnDefaults {
  /** Merged over `DEFAULT_WATCHDOG`, under `EngineOptions.watchdog`. */
  watchdog?: Partial<WatchdogOptions>;
  /** Used when `EngineOptions.spare` isn't given. */
  spare?: boolean;
}

/**
 * The parts of a Web Worker {@link fromWorker} uses; a DOM `Worker` has them.
 * @public
 */
export interface WorkerLike {
  /** Posts a message to the worker. */
  postMessage(message: unknown): void;
  /** Stops the worker. */
  terminate(): void;
  /** Messages from the worker arrive as `event.data`. */
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /** The worker failed, or a message from it couldn't be deserialized. */
  addEventListener(type: "error" | "messageerror", listener: (event: unknown) => void): void;
}

/**
 * A {@link SpawnEngine} for Web Workers (or anything shaped like one).
 * @public
 */
export const fromWorker =
  (create: () => WorkerLike): SpawnEngine =>
  (events) => {
    const worker = create();
    worker.addEventListener("message", (event) => events.message(event.data as ServerMessage));
    worker.addEventListener("error", (event) => {
      // Handled here: without this, browsers also report it as an uncaught error of the page.
      (event as { preventDefault?(): void }).preventDefault?.();
      events.error(event);
    });
    // A message that can't be deserialized leaves a request unanswered forever.
    worker.addEventListener("messageerror", (event) => events.error(event));
    return worker;
  };

/** Why a worker went away with requests unanswered. */
export type GoneReason = "timeout" | "crash" | "recycle" | "dispose" | "disconnect";

/** @internal Rejects every request pending on a worker that was terminated. */
export class WorkerGone extends Error {
  readonly reason: GoneReason;

  constructor(reason: GoneReason) {
    super(`engine worker terminated (${reason})`);
    this.name = "WorkerGone";
    this.reason = reason;
  }
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: unknown): void;
}

/** @internal One worker and its unanswered requests. */
export class Connection {
  private port: EngineConnection | null;
  private nextId = 1;
  private readonly pending = new Map<RequestId, Pending>();

  /** `spawn` may throw (e.g. the worker script can't be created); the constructor rethrows. */
  constructor(
    spawn: SpawnEngine,
    onNotification: (notification: ServerNotification) => void,
    onError: (error: unknown, lost?: boolean) => void,
  ) {
    this.port = spawn({
      message: (m) => {
        // Messages already queued when the worker was terminated still arrive.
        if (!this.port) return;
        if (!isResponse(m)) return onNotification(m);
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (isErrorResponse(m)) p.reject(ProtocolError.from(m.error));
        else p.resolve(m.result);
      },
      error: (e) => {
        if (this.port) onError(e);
      },
      lost: (e) => {
        if (this.port) onError(e, true);
      },
    });
  }

  get alive(): boolean {
    return this.port !== null;
  }

  /** Requests are waiting for their answer. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  request<M extends RequestMethod>(method: M, params: ParamsOf<M>): { id: RequestId; result: Promise<ResultOf<M>> } {
    const id = this.nextId++;
    const result = new Promise<ResultOf<M>>((resolve, reject) => {
      if (!this.port) return reject(new WorkerGone("dispose"));
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
      this.port.postMessage({ id, method, params } as ClientMessage);
    });
    return { id, result };
  }

  /** A request whose answer nobody waits for; failures surface through the compile that follows it. */
  send<M extends RequestMethod>(method: M, params: ParamsOf<M>): void {
    this.request(method, params).result.catch(() => {});
  }

  notify<M extends ClientNotificationMethod>(method: M, params: ClientNotificationMap[M]): void {
    this.port?.postMessage({ method, params } as ClientMessage);
  }

  /** Terminates the worker and rejects what it still owes with `WorkerGone(reason)`. */
  close(reason: GoneReason): void {
    const port = this.port;
    if (!port) return;
    this.port = null;
    port.terminate();
    const gone = new WorkerGone(reason);
    for (const p of this.pending.values()) p.reject(gone);
    this.pending.clear();
  }
}
