// A minimal protocol client for tests: correlates responses with requests and
// records every server message in arrival order. Transports plug in below.

import {
  type ClientMessage,
  deserializeMessage,
  isErrorResponse,
  isResponse,
  type ParamsOf,
  ProtocolError,
  type RequestMethod,
  type ResultOf,
  type ServerMessage,
  type ServerNotification,
  serializeMessage,
} from "@typstream/core";
import { WebSocket } from "ws";
import type { ProtocolServer } from "../../src";

/** Moves client messages to a server and server messages back. */
export interface Transport {
  send(message: ClientMessage | unknown): void;
  onMessage(listener: (message: ServerMessage) => void): void;
  close(): void;
}

export class TestClient {
  /** Every server message, in arrival order. */
  readonly log: ServerMessage[] = [];
  private nextId = 1;
  private readonly waiting = new Map<number, (m: ServerMessage) => void>();

  constructor(private readonly transport: Transport) {
    transport.onMessage((m) => {
      this.log.push(m);
      if (isResponse(m)) this.waiting.get(m.id)?.(m);
    });
  }

  /** Sends a request without waiting; returns its id and the eventual response. */
  start<M extends RequestMethod>(method: M, params: ParamsOf<M>): { id: number; done: Promise<ResultOf<M>> } {
    const id = this.nextId++;
    const done = new Promise<ResultOf<M>>((resolve, reject) => {
      this.waiting.set(id, (m) => {
        this.waiting.delete(id);
        if (!isResponse(m)) return;
        if (isErrorResponse(m)) reject(ProtocolError.from(m.error));
        else resolve(m.result as ResultOf<M>);
      });
    });
    this.transport.send({ id, method, params });
    return { id, done };
  }

  request<M extends RequestMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    return this.start(method, params).done;
  }

  /** The error code a request fails with. */
  async errorOf<M extends RequestMethod>(method: M, params: ParamsOf<M>): Promise<string> {
    try {
      await this.request(method, params);
    } catch (error) {
      if (error instanceof ProtocolError) return error.code;
      throw error;
    }
    throw new Error(`${method} succeeded`);
  }

  send(message: unknown): void {
    this.transport.send(message);
  }

  /** Notifications received so far. */
  notifications(): ServerNotification[] {
    return this.log.filter((m): m is ServerNotification => !isResponse(m));
  }

  /** Index in `log` of the response to `id`. */
  responseIndex(id: number): number {
    return this.log.findIndex((m) => isResponse(m) && m.id === id);
  }

  initialize(pagedDiff = true): Promise<ResultOf<"initialize">> {
    return this.request("initialize", { protocolVersion: 1, capabilities: { pagedDiff } });
  }

  close(): void {
    this.transport.close();
  }
}

/** Calls the server in-process, through core's codec so bytes take the same path as over a socket. */
export const inProcess = (server: ProtocolServer): Transport => {
  let listener: (m: ServerMessage) => void = () => {};
  const connection = server.connect((m) => {
    const copy = deserializeMessage(serializeMessage(m)) as ServerMessage;
    queueMicrotask(() => listener(copy));
  });
  return {
    send: (m) => connection.receive(deserializeMessage(serializeMessage(m))),
    onMessage: (l) => {
      listener = l;
    },
    close: () => connection.close(),
  };
};

/** A real WebSocket client connected to `url`. */
export const overWebSocket = async (url: string): Promise<Transport> => {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  let listener: (m: ServerMessage) => void = () => {};
  ws.on("message", (data) => listener(deserializeMessage(String(data)) as ServerMessage));
  return {
    send: (m) => ws.send(serializeMessage(m)),
    onMessage: (l) => {
      listener = l;
    },
    close: () => ws.close(),
  };
};
