// The worker protocol (`@typstream/core`, PLAN §6.1) served from Node, for
// clients that shouldn't download the engine. The protocol itself is
// `@typstream/engine`'s server (#10), the same code that runs in the browser
// worker; this file gives it an adapter that compiles on the Node engine's
// worker pool, and a gate for messages from untrusted remote clients.
//
// Documents (text, files, inputs, page hashes) live here on the main thread.
// Pool workers only compile, so the watchdog can kill one without losing a
// document: the compile it stopped reports a `timeout` diagnostic.

import { createHash } from "node:crypto";
import {
  type ClientMessage,
  type CompileMode,
  deserializeMessage,
  type PageUpdate,
  ProtocolError,
  type ServerMessage,
  serializeMessage,
} from "@typstream/core";
import { type AdapterDocument, createServer, type EngineAdapter, TYPST_VERSION } from "@typstream/engine/server";
import { fileEntry, toVirtualPath } from "./document";
import { type Compiled, compile, defaultEngine, type NodeEngine } from "./engine";
import type { JobOp } from "./jobs";
import type { FileEntry } from "./pool";

/** Limits and identity for {@link createProtocolServer}; every connection gets the same. @public */
export interface ProtocolServerOptions {
  /** Default: {@link defaultEngine}. */
  engine?: NodeEngine;
  /** Watchdog budget per compile by `mode`, in ms; exports are `final`. Default 3,000 streaming, 10,000 final (PLAN §6.3). */
  timeouts?: { streaming?: number; final?: number };
  /** Open documents per connection. Default 32. */
  maxDocuments?: number;
  /** Longest `/main.typ` (preamble and text), in UTF-16 code units. Default 1,000,000 (PLAN §9). */
  maxTextLength?: number;
  /** Reported in `initialize`'s `serverInfo`. */
  serverInfo?: { name?: string; version?: string };
}

/** One client's session. @public */
export interface ProtocolConnection {
  /** Handles a message from the client. Malformed messages are answered (requests) or logged (notifications). */
  receive(message: unknown): void;
  /** The client went away: drops its queued requests and documents; nothing more is sent. */
  close(): void;
}

/** The engine protocol served from Node: one session per client connection. @public */
export interface ProtocolServer {
  /** Starts a session; `send` delivers server messages to the client, in order. */
  connect(send: (message: ServerMessage) => void): ProtocolConnection;
}

/** Content hash of a page's SVG, to diff pages that different workers exported. */
const contentHash = (svg: string): string => createHash("sha1").update(svg).digest("hex");

/**
 * engine-wasm on the pool as `@typstream/engine`'s `EngineAdapter`, one per
 * connection. Fonts are the engine's: `initialize`'s fonts and packages are
 * ignored, and so are `document/open`'s packages. It has no `addFonts`, so
 * nothing loads from font catalogues.
 */
const poolAdapter = (engine: NodeEngine, options: ProtocolServerOptions): EngineAdapter => {
  const maxDocuments = options.maxDocuments ?? 32;
  const maxTextLength = options.maxTextLength ?? 1_000_000;
  const budget = (mode: CompileMode = "streaming"): number =>
    mode === "final" ? (options.timeouts?.final ?? 10_000) : (options.timeouts?.streaming ?? 3_000);
  let openDocuments = 0;
  let nextToken = 1;

  return {
    info: {
      name: options.serverInfo?.name ?? "@typstream/node",
      ...(options.serverInfo?.version ? { version: options.serverInfo.version } : {}),
      typstVersion: TYPST_VERSION,
    },
    targets: ["html", "paged"],
    exports: ["pdf", "html"],
    init: async () => {},

    open(): AdapterDocument {
      if (openDocuments >= maxDocuments) {
        throw new ProtocolError("invalid-params", `at most ${maxDocuments} documents can be open`);
      }
      openDocuments++;
      let closed = false;
      let main = "";
      const files = new Map<string, FileEntry>();
      let inputs: Record<string, string> = {};
      /** Compiles of this document prefer the worker that compiled it last. */
      const affinity = {};
      /**
       * Pages as of the last successful paged compile: content hashes by index,
       * and the token of the worker baseline they match.
       */
      let paged: { hashes: string[]; token: string } | null = null;

      const run = (
        op: JobOp,
        mode: CompileMode | undefined,
        extra: { baseline?: string | null; token?: string } = {},
      ) => compile(engine, { text: main, op, files, inputs, timeoutMs: budget(mode), affinity, ...extra });
      const timings = (c: Compiled) => ({ compileMs: c.result?.compileMs, exportMs: c.result?.exportMs });

      return {
        setFiles(delta) {
          for (const [path, content] of Object.entries(delta)) {
            if (path === "/main.typ") {
              const text = typeof content === "string" ? content : "";
              if (text.length > maxTextLength) {
                throw new ProtocolError("invalid-params", `the document exceeds ${maxTextLength} UTF-16 code units`);
              }
              main = text;
              continue;
            }
            // Throws on paths outside the document; the server answers invalid-params.
            const virtual = toVirtualPath(path);
            if (content === null) files.delete(virtual);
            else files.set(virtual, fileEntry(content));
          }
        },
        setInputs(next) {
          inputs = { ...next };
        },
        async compileHtml(o) {
          const c = await run("html", o?.mode);
          return { html: c.ok ? (c.result?.html ?? "") : null, diagnostics: c.diagnostics, ...timings(c) };
        },
        async compilePaged({ fullPages, mode }) {
          // The worker exports only changed pages when its baseline is this document's
          // last paged compile (same token); otherwise every page.
          const token = String(nextToken++);
          const c = await run("svg", mode, { baseline: fullPages ? null : (paged?.token ?? null), token });
          const r = c.result;
          if (!c.ok || !r) return { output: null, diagnostics: c.diagnostics, ...timings(c) };
          const pageCount = r.pageCount ?? 0;
          const exported = (r.pages ?? []).map((page) => ({ page, content: contentHash(page.svg) }));
          let hashes: string[];
          let changed = exported;
          if (r.full) {
            hashes = exported.map((p) => p.content);
            // Every page came back (another worker, or a reset): send the ones that differ.
            const before = paged;
            if (!fullPages && before) changed = exported.filter((p) => before.hashes[p.page.index] !== p.content);
          } else {
            hashes = (paged?.hashes ?? []).slice(0, pageCount);
            for (const p of exported) hashes[p.page.index] = p.content;
          }
          paged = { hashes, token };
          const pages: PageUpdate[] = changed.map((p) => p.page);
          return { output: { pageCount, changed: pages }, diagnostics: c.diagnostics, ...timings(c) };
        },
        async check({ target, mode }) {
          // HTML has no changed-page baseline; a paged check exports nothing.
          const c = await run(target === "html" ? "html" : "check", mode);
          return { diagnostics: c.diagnostics, ...timings(c) };
        },
        async exportPdf() {
          const c = await run("pdf", "final");
          return { pdf: c.ok ? (c.result?.pdf ?? null) : null, diagnostics: c.diagnostics, ...timings(c) };
        },
        close() {
          if (closed) return;
          closed = true;
          openDocuments--;
        },
      };
    },
  };
};

// --- the gate: remote clients are untrusted, so check shapes before the server reads them

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const optional = (v: unknown, check: (v: unknown) => boolean): boolean => v === undefined || check(v);
const isStringRecord = (v: unknown): boolean => isObject(v) && Object.values(v).every((x) => typeof x === "string");
const isFiles = (v: unknown): boolean =>
  isObject(v) && Object.values(v).every((x) => x === null || typeof x === "string" || x instanceof Uint8Array);
const isEdit = (e: unknown): boolean => isObject(e) && isInt(e.from) && isInt(e.to) && typeof e.insert === "string";
const isFlag = (v: unknown): boolean => typeof v === "boolean";
const isSkip = (r: unknown): boolean =>
  isObject(r) && isInt(r.from) && isInt(r.to) && (r.reason === "timeout" || r.reason === "crash");
const isFallback = (v: unknown): boolean =>
  isObject(v) &&
  optional(v.isolate, isFlag) &&
  optional(v.stablePrefix, isFlag) &&
  optional(v.restart, isFlag) &&
  optional(v.skip, (s) => Array.isArray(s) && s.every(isSkip));

/** Why a request's params can't be handled, or `null` if they look right. */
const paramsProblem = (method: string, p: unknown): string | null => {
  if (method === "shutdown") return null;
  if (!isObject(p)) return "params must be an object";
  if (method === "initialize") {
    if (typeof p.protocolVersion !== "number") return "protocolVersion must be a number";
    return optional(p.capabilities, isObject) ? null : "capabilities must be an object";
  }
  if (typeof p.uri !== "string" || !isInt(p.rev)) return "expected { uri: string, rev: integer }";
  switch (method) {
    case "document/open":
      if (typeof p.text !== "string") return "text must be a string";
      if (!optional(p.preamble, (v) => typeof v === "string")) return "preamble must be a string";
      return optional(p.files, isFiles) ? null : "files must map paths to a string, bytes or null";
    case "document/edit":
      return Array.isArray(p.edits) && p.edits.every(isEdit)
        ? null
        : "edits must be [{ from: integer, to: integer, insert: string }]";
    case "document/setFiles":
      return isFiles(p.files) ? null : "files must map paths to a string, bytes or null";
    case "compile":
      if (typeof p.target !== "string") return "target must be a string";
      if (!optional(p.mode, (v) => v === "streaming" || v === "final")) return 'mode must be "streaming" or "final"';
      if (!optional(p.fullPages, (v) => typeof v === "boolean")) return "fullPages must be a boolean";
      if (!optional(p.settled, isInt) || !optional(p.settledFrom, isInt)) {
        return "settled and settledFrom must be integers";
      }
      if (!optional(p.fallback, isFallback)) return "fallback must be { isolate?, stablePrefix?, restart?, skip? }";
      return optional(p.inputs, isStringRecord) ? null : "inputs must map names to strings";
    case "export/pdf":
    case "export/html":
      return optional(p.inputs, isStringRecord) ? null : "inputs must map names to strings";
    default:
      return null;
  }
};

/**
 * Serves the protocol on a {@link NodeEngine}, with `@typstream/engine`'s
 * server: targets `html` and `paged` (with changed-page updates), exports
 * `pdf` and `html`; no `resolve/*` yet. Each connection has its own documents.
 * @public
 */
export const createProtocolServer = (options: ProtocolServerOptions = {}): ProtocolServer => {
  const engine = options.engine ?? defaultEngine();
  return {
    connect(send) {
      let closed = false;
      /** Requests received and not answered yet: cancelled when the client goes away. */
      const outstanding = new Set<number>();
      const server = createServer(
        poolAdapter(engine, options),
        (message) => {
          if ("id" in message) outstanding.delete(message.id);
          if (!closed) send(message);
        },
        // Clients are untrusted: their package lists and font catalogues would make the server
        // fetch any URL, and their fixer modules would run code in it.
        { packages: { trustClient: false }, fontCatalogues: { trustClient: false }, clientFixers: false },
      );
      const reply = (message: ServerMessage): void => {
        if (!closed) send(message);
      };
      return {
        receive(message) {
          if (closed) return;
          if (!isObject(message) || typeof message.method !== "string") {
            if (isObject(message) && isInt(message.id)) {
              reply({ id: message.id, error: { code: "invalid-params", message: "malformed message" } });
            } else reply({ method: "$/log", params: { level: "warn", message: "ignored a malformed message" } });
            return;
          }
          if (!("id" in message)) {
            // The only client notification; anything else is ignored.
            if (message.method === "$/cancel" && isObject(message.params) && isInt(message.params.id)) {
              server.receive(message as ClientMessage);
            }
            return;
          }
          if (!isInt(message.id)) {
            reply({ method: "$/log", params: { level: "warn", message: "ignored a request without an integer id" } });
            return;
          }
          const problem = paramsProblem(message.method, message.params);
          if (problem) {
            reply({ id: message.id, error: { code: "invalid-params", message: problem } });
            return;
          }
          outstanding.add(message.id);
          server.receive(message as ClientMessage);
        },
        close() {
          if (closed) return;
          closed = true;
          // Drop what hasn't started, then free the documents.
          for (const id of outstanding) server.receive({ method: "$/cancel", params: { id } });
          server.receive({ id: -1, method: "shutdown", params: null });
        },
      };
    },
  };
};

/**
 * The parts of a WebSocket {@link handleWebSocket} uses; `ws`'s `WebSocket`
 * fits, and so does anything with the same `on` / `send` / `close`.
 * @public
 */
export interface WebSocketLike {
  /** Sends one text message: a server message in core's wire format. */
  send(data: string): void;
  /** Closes the socket with a WebSocket close code and reason. */
  close(code?: number, reason?: string): void;
  /** Subscribes to `"message"` (a text frame: string, `Buffer`, `ArrayBuffer` or fragments) and `"close"`. */
  on(event: string, listener: (...args: never[]) => void): unknown;
}

const text = (data: unknown): string => {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data as Uint8Array[]).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
};

/**
 * Serves one WebSocket: each text message is a client message in core's wire
 * format (`serializeMessage` from `@typstream/core`); replies go back the same
 * way. Cap message sizes on the socket server (`ws`'s `maxPayload`).
 *
 * @example
 * ```ts
 * import { WebSocketServer } from "ws";
 * const server = createProtocolServer();
 * new WebSocketServer({ port: 8080, maxPayload: 8 << 20 }).on("connection", (ws) => handleWebSocket(ws, server));
 * ```
 * @public
 */
export const handleWebSocket = (socket: WebSocketLike, server: ProtocolServer): ProtocolConnection => {
  const connection = server.connect((message) => socket.send(serializeMessage(message)));
  socket.on("message", (data: unknown) => {
    let message: unknown;
    try {
      message = deserializeMessage(text(data));
    } catch {
      socket.send(
        serializeMessage({ method: "$/log", params: { level: "warn", message: "ignored a message that isn't JSON" } }),
      );
      return;
    }
    connection.receive(message);
  });
  socket.on("close", () => connection.close());
  return connection;
};
