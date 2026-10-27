// @typstream/engine/websocket: a SpawnEngine over a WebSocket (PLAN §6.1 "As
// built (#85)"), for an engine served by @typstream/node's `handleWebSocket`.
// Its own entry point, so apps on the worker don't carry it (or core's codec)
// in the main-thread budget.
//
// A connection is a session on the server: a new one has no documents, so
// every reconnect goes through the client, which reopens them. Only opening a
// connection is retried here, since nothing has reached the server yet.

import { deserializeMessage, type ServerMessage, serializeMessage } from "@typstream/core";
import type { SpawnDefaults, SpawnEngine } from "./connection";

export type { EngineConnection, EngineEvents, SpawnDefaults, SpawnEngine } from "./connection";
export type { WatchdogOptions } from "./document";

/**
 * The parts of a WebSocket {@link fromWebSocket} uses; the browser's (and
 * Node 22's global) `WebSocket` has them.
 * @beta
 */
export interface WebSocketLike {
  /** 1 once open. */
  readonly readyState: number;
  /** Sends a text message. */
  send(data: string): void;
  /** Closes the connection, or abandons the attempt to open it. */
  close(code?: number, reason?: string): void;
  /** The connection opened. */
  addEventListener(type: "open", listener: () => void): void;
  /** A message from the server, as `event.data`. */
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /** After a failed connection attempt too: then no `open` came first. */
  addEventListener(type: "close", listener: (event: { code: number; reason: string }) => void): void;
}

/**
 * Options of {@link fromWebSocket}.
 * @beta
 */
export interface WebSocketOptions {
  /** Subprotocols, for the `WebSocket` constructor. */
  protocols?: string | string[];
  /** Attempts to open a connection after the first fails, before the engine gives up. Default 4. */
  retries?: number;
  /** Wait before the first retry, in ms, doubled for each one after it. Default 500 (0.5 + 1 + 2 + 4 s). */
  retryDelayMs?: number;
  /** The WebSocket class. Default: the global `WebSocket` (browsers, Node 22+). */
  WebSocket?: new (
    url: string,
    protocols?: string | string[],
  ) => WebSocketLike;
}

/**
 * What {@link fromWebSocket} suggests to `createEngine`: no spare connection
 * (it would be a second session on the server, and the server's own watchdog
 * answers first, so replacements are rare), and budgets above the worst a
 * `@typstream/node` server takes with its default timeouts (4.5 s streaming,
 * 15 s final: the fallback's last compile starts by 1.5 s / 5 s and runs up to
 * 3 s / 10 s), with room for the network and the server's queue. Hang probes
 * are final compiles there, so they get the final budget.
 * @beta
 */
export const WEBSOCKET_DEFAULTS: Readonly<SpawnDefaults> = {
  watchdog: { streamingMs: 10_000, finalMs: 30_000, probeMs: 30_000 },
  spare: false,
};

const OPEN = 1;

/**
 * A {@link SpawnEngine} that connects to an engine server over a WebSocket:
 * each call opens a connection, a session with its own documents. Messages
 * are core's wire format (`serializeMessage`). Pass it to `createEngine`.
 *
 * - **Watchdog.** A compile past its budget closes the connection (the server
 *   cancels what the session had queued) and opens a new one. The budgets of
 *   {@link WEBSOCKET_DEFAULTS} let the server's own timeout answer first.
 * - **Opening.** An attempt that fails is retried (`retries`, with backoff);
 *   when every attempt fails, the engine fails, or a replacement does.
 * - **Dropped connections** are reported as `lost`: the engine emits
 *   `disconnect`, opens a new connection, and retries the compile or export
 *   that was running, without a watchdog strike. One that drops before
 *   answering `initialize` fails the engine (a server that refuses us).
 *
 * @param url - The server's `ws:` or `wss:` URL, or a function returning it,
 *   called for every connection (to sign each one afresh, say).
 * @example
 * ```ts
 * import { createEngine } from "@typstream/engine";
 * import { fromWebSocket } from "@typstream/engine/websocket";
 * const engine = createEngine({ spawn: fromWebSocket("wss://typst.example.com/typst") });
 * ```
 * @beta
 */
export const fromWebSocket = (url: string | URL | (() => string | URL), options: WebSocketOptions = {}): SpawnEngine =>
  Object.assign(
    ((events) => {
      const Socket = options.WebSocket ?? (globalThis as { WebSocket?: WebSocketOptions["WebSocket"] }).WebSocket;
      if (!Socket) throw new Error("no WebSocket class here: pass fromWebSocket's `WebSocket` option");
      const retries = options.retries ?? 4;
      const delay = options.retryDelayMs ?? 500;
      let socket: WebSocketLike;
      /** Messages posted before the connection opened, sent once it does. */
      let queued: string[] = [];
      let opened = false;
      let stopped = false;
      let attempt = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let target = "";

      const connect = (): void => {
        target = String(typeof url === "function" ? url() : url);
        const s = new Socket(target, options.protocols);
        socket = s;
        s.addEventListener("open", () => {
          if (stopped) return;
          opened = true;
          for (const text of queued) s.send(text);
          queued = [];
        });
        s.addEventListener("message", (event) => {
          if (stopped) return;
          let message: ServerMessage;
          try {
            message = deserializeMessage(String(event.data)) as ServerMessage;
          } catch (error) {
            events.error(error);
            return;
          }
          events.message(message);
        });
        s.addEventListener("close", (event) => {
          if (stopped) return;
          const why = `${event.code}${event.reason ? `, ${event.reason}` : ""}`;
          if (opened) {
            stopped = true;
            events.lost(new Error(`the connection to the engine at ${target} closed (${why})`));
          } else if (attempt < retries) {
            retry = setTimeout(connect, delay * 2 ** attempt++);
          } else {
            stopped = true;
            events.error(new Error(`could not connect to the engine at ${target} (${why})`));
          }
        });
      };
      connect();

      return {
        postMessage(message) {
          if (stopped) return;
          const text = serializeMessage(message);
          if (!opened) queued.push(text);
          // Sent between the close and its event: the request is rejected with the connection.
          else if (socket.readyState === OPEN) socket.send(text);
        },
        terminate() {
          stopped = true;
          clearTimeout(retry);
          socket.close();
        },
      };
    }) as SpawnEngine,
    { defaults: WEBSOCKET_DEFAULTS },
  );
