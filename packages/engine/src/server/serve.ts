// Transports for the engine server: a Web Worker's global scope (`serve`), or
// the calling thread (`inProcess`).

import type { ClientMessage, ServerMessage } from "@typstream/core";
import type { SpawnEngine } from "../connection";
import type { EngineAdapter } from "./adapter";
import { createServer, type EngineServer, type ServerOptions } from "./server";

/**
 * The parts of a worker's global scope {@link serve} uses.
 * @public
 */
export interface WorkerScope {
  /** Sends a message to the client. */
  postMessage(message: unknown): void;
  /** Messages from the client arrive as `event.data`. */
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/**
 * Runs the engine server in this worker: answers the client's messages with
 * `adapter`. A worker script is one call. `options.fixers` replaces the
 * built-in diagnostic fixers ({@link DEFAULT_FIXERS}).
 *
 * @example
 * ```ts
 * // engine.worker.ts
 * import { engineWasm, serve } from "@typstream/engine/server";
 * serve(engineWasm({ wasm: "/assets/typst.wasm", fonts: ["/fonts/Inter.otf"] }));
 * ```
 * @public
 */
export const serve = (
  adapter: EngineAdapter,
  scope?: WorkerScope,
  options: Pick<ServerOptions, "fixers"> = {},
): EngineServer => {
  const self = scope ?? (globalThis as unknown as WorkerScope);
  const server = createServer(adapter, (message) => self.postMessage(message), {
    ...options,
    // Thrown outside the protocol, the error reaches the client as the worker's
    // `error` event, and the client replaces the worker.
    onFatal: (error) =>
      setTimeout(() => {
        throw error;
      }),
  });
  self.addEventListener("message", (event) => server.receive(event.data as ClientMessage));
  return server;
};

/**
 * A {@link SpawnEngine} that runs the server on the calling thread, for tests
 * and Node. Messages are structured-cloned and delivered on later tasks, as a
 * worker's would be, but compiles block the thread and `terminate` can't stop
 * one that is running, so the watchdog can't rescue a runaway document.
 * `createAdapter` is called once per spawn; `options.fixers` is as in {@link serve}.
 * @beta
 */
export const inProcess =
  (createAdapter: () => EngineAdapter, options: Pick<ServerOptions, "fixers"> = {}): SpawnEngine =>
  (events) => {
    let alive = true;
    const server = createServer(
      createAdapter(),
      (message: ServerMessage) => {
        const copy = structuredClone(message);
        setTimeout(() => alive && events.message(copy));
      },
      { ...options, onFatal: (error) => setTimeout(() => alive && events.error(error)) },
    );
    return {
      postMessage: (message) => {
        const copy = structuredClone(message);
        setTimeout(() => alive && server.receive(copy));
      },
      terminate: () => {
        alive = false;
      },
    };
  };
