// The worker protocol (`@typstream/core`, PLAN §6.1) served from Node, for
// clients that shouldn't download the engine. Transport-agnostic: a connection
// takes decoded client messages and hands back server messages;
// `handleWebSocket` wires one to a socket using core's text codec.
//
// Protocol state (documents, revisions, page hashes) lives here, on the main
// thread. Pool workers only compile, so the watchdog can kill one without
// losing a document.

import { createHash } from "node:crypto";
import {
  type Artifact,
  type ClientMessage,
  type CompileParams,
  type CompileResult,
  type CompileTarget,
  type Diagnostic,
  type DocumentEditParams,
  type DocumentOpenParams,
  type DocumentParams,
  type DocumentSetFilesParams,
  deserializeMessage,
  type ErrorCode,
  type ExportParams,
  type ExportResult,
  type FileDelta,
  type InitializeParams,
  type InitializeResult,
  normalizeDiagnostics,
  type PagedArtifact,
  PROTOCOL_VERSION,
  ProtocolError,
  type Request,
  type RequestId,
  type RequestMethod,
  type Revision,
  type ServerMessage,
  type ServerNotification,
  serializeMessage,
} from "@typstream/core";
import { fileEntry, toVirtualPath } from "./document";
import { type Compiled, compile, defaultEngine, type NodeEngine } from "./engine";
import type { FileEntry } from "./pool";

/** @public */
export interface ProtocolServerOptions {
  /** Default: {@link defaultEngine}. */
  engine?: NodeEngine;
  /** Watchdog budget per compile by `mode`, in ms. Default 3,000 streaming, 10,000 final (PLAN §6.3). */
  timeouts?: { streaming?: number; final?: number };
  /** Open documents per connection. Default 32. */
  maxDocuments?: number;
  /** Longest document text, in UTF-16 code units. Default 1,000,000 (PLAN §9). */
  maxTextLength?: number;
  /** Reported in `initialize`'s `serverInfo`. */
  serverInfo?: { name?: string; version?: string };
}

/** One client's session. @public */
export interface ProtocolConnection {
  /** Handles a message from the client. Malformed messages are answered (requests) or logged (notifications). */
  receive(message: unknown): void;
  /** The client went away: drops its documents and queued requests; nothing more is sent. */
  close(): void;
}

/** @public */
export interface ProtocolServer {
  /** Starts a session; `send` delivers server messages to the client, in order. */
  connect(send: (message: ServerMessage) => void): ProtocolConnection;
}

const TYPST_VERSION = "0.15.1";

interface Document {
  uri: string;
  rev: Revision;
  text: string;
  preamble: string | undefined;
  files: Map<string, FileEntry>;
  /** The last paged artifact sent: its revision, every page's hash, and the worker baseline token. */
  paged: { rev: Revision; hashes: string[]; token: string } | null;
  /** Affinity key: compiles of this document prefer the same worker. */
  key: object;
}

const pageHash = (svg: string): string => createHash("sha1").update(svg).digest("hex").slice(0, 16);

/** A page's size in points, from the root `<svg viewBox="0 0 w h">` Typst writes. */
const pageSize = (svg: string): { width: number; height: number } => {
  const m = /^<svg[^>]*?\sviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return { width: Number(m?.[1] ?? 0), height: Number(m?.[2] ?? 0) };
};

// --- param checks: the client is remote and untrusted, so check shapes before using them

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isRev = (v: unknown): v is number => Number.isSafeInteger(v);

const invalid = (message: string): ProtocolError => new ProtocolError("invalid-params", message);

const documentParams = (p: unknown): DocumentParams => {
  if (!isObject(p) || typeof p.uri !== "string" || !isRev(p.rev))
    throw invalid("expected { uri: string, rev: integer }");
  return p as unknown as DocumentParams;
};

const fileDelta = (v: unknown): FileDelta => {
  if (v === undefined) return {};
  if (!isObject(v)) throw invalid("files must be an object of path → string | bytes | null");
  for (const [path, data] of Object.entries(v)) {
    if (data !== null && typeof data !== "string" && !(data instanceof Uint8Array)) {
      throw invalid(`files["${path}"] must be a string, bytes or null`);
    }
  }
  return v as FileDelta;
};

const stringRecord = (v: unknown, what: string): Record<string, string> | undefined => {
  if (v === undefined) return undefined;
  if (!isObject(v) || Object.values(v).some((x) => typeof x !== "string"))
    throw invalid(`${what} must map names to strings`);
  return v as Record<string, string>;
};

/**
 * Serves the protocol on top of a {@link NodeEngine}. Capabilities: targets
 * `html` and `paged` (with changed-page updates), exports `pdf` and `html`;
 * no `resolve/*` yet. Fonts and packages sent in `initialize` are ignored: the
 * engine's fonts are configured on the server.
 * @public
 */
export const createProtocolServer = (options: ProtocolServerOptions = {}): ProtocolServer => {
  const engine = options.engine ?? defaultEngine();
  const timeouts = { streaming: options.timeouts?.streaming ?? 3_000, final: options.timeouts?.final ?? 10_000 };
  const maxDocuments = options.maxDocuments ?? 32;
  const maxTextLength = options.maxTextLength ?? 1_000_000;
  let nextToken = 1;

  return {
    connect(send) {
      let state: "new" | "ready" | "shut-down" | "closed" = "new";
      let pagedDiff = false;
      const documents = new Map<string, Document>();
      const queue: { request: Request; t0: number }[] = [];
      const cancelled = new Set<RequestId>();
      let running = false;

      const emit = (message: ServerMessage): void => {
        if (state !== "closed") send(message);
      };
      const notify = (n: ServerNotification): void => emit(n);
      const fail = (id: RequestId, code: ErrorCode, message: string, data?: unknown): void =>
        emit({ id, error: new ProtocolError(code, message, data).toJSON() });

      const open = (p: DocumentParams): Document => {
        const doc = documents.get(p.uri);
        if (!doc) throw new ProtocolError("document-not-open", `document ${p.uri} is not open`);
        return doc;
      };
      /** A document at its current revision; compiling an older one is pointless. */
      const current = (p: DocumentParams): Document => {
        const doc = open(p);
        if (p.rev !== doc.rev) {
          throw new ProtocolError("content-modified", `${p.uri} is at revision ${doc.rev}, not ${p.rev}`);
        }
        return doc;
      };
      const advance = (doc: Document, rev: unknown): void => {
        if (!isRev(rev)) throw invalid("rev must be an integer");
        if (rev <= doc.rev) {
          throw new ProtocolError("stale-revision", `${doc.uri} is at revision ${doc.rev}; ${rev} is not newer`);
        }
        doc.rev = rev;
      };
      const checkLength = (text: string): void => {
        if (text.length > maxTextLength) throw invalid(`document text exceeds ${maxTextLength} UTF-16 code units`);
      };
      const applyFiles = (doc: Document, delta: FileDelta): void => {
        for (const [path, data] of Object.entries(delta)) {
          let virtual: string;
          try {
            virtual = toVirtualPath(path);
          } catch (error) {
            throw invalid((error as Error).message);
          }
          if (data === null) doc.files.delete(virtual);
          else doc.files.set(virtual, fileEntry(data));
        }
      };

      const pagedArtifact = (doc: Document, compiled: Compiled, token: string, fullPages: boolean): PagedArtifact => {
        const r = compiled.result;
        const pageCount = r?.pageCount ?? 0;
        const exported = (r?.pages ?? []).map((p) => ({ ...p, hash: pageHash(p.svg) }));
        const previous = doc.paged;
        let hashes: string[];
        let changed = exported;
        if (r?.full) {
          hashes = exported.map((p) => p.hash);
        } else {
          // The worker diffed against `previous` (same token): unlisted pages are unchanged.
          hashes = (previous?.hashes ?? []).slice(0, pageCount);
          for (const p of exported) hashes[p.index] = p.hash;
        }
        const diff = pagedDiff && !fullPages && previous !== null;
        if (diff && r?.full) changed = exported.filter((p) => previous.hashes[p.index] !== p.hash);
        doc.paged = { rev: doc.rev, hashes, token };
        return {
          target: "paged",
          base: diff ? previous.rev : null,
          pageCount,
          pages: changed.map((p) => ({ index: p.index, hash: p.hash, ...pageSize(p.svg), svg: p.svg })),
        };
      };

      const handlers: { [M in RequestMethod]: (params: unknown, id: RequestId) => Promise<unknown> | unknown } = {
        initialize: () => {
          throw invalid("already initialized");
        },
        shutdown: () => {
          documents.clear();
          state = "shut-down";
          return null;
        },
        "document/open": (raw) => {
          const p = documentParams(raw) as DocumentOpenParams;
          if (typeof p.text !== "string") throw invalid("text must be a string");
          if (p.preamble !== undefined && typeof p.preamble !== "string") throw invalid("preamble must be a string");
          if (documents.has(p.uri)) throw new ProtocolError("document-already-open", `${p.uri} is already open`);
          if (documents.size >= maxDocuments) throw invalid(`at most ${maxDocuments} documents can be open`);
          checkLength(p.text);
          const doc: Document = {
            uri: p.uri,
            rev: p.rev,
            text: p.text,
            preamble: p.preamble,
            files: new Map(),
            paged: null,
            key: {},
          };
          applyFiles(doc, fileDelta(p.files));
          documents.set(p.uri, doc);
          return null;
        },
        "document/edit": (raw) => {
          const p = documentParams(raw) as DocumentEditParams;
          const doc = open(p);
          if (!Array.isArray(p.edits)) throw invalid("edits must be an array");
          let text = doc.text;
          for (const e of p.edits as unknown[]) {
            if (!isObject(e) || !isRev(e.from) || !isRev(e.to) || typeof e.insert !== "string") {
              throw invalid("an edit is { from: integer, to: integer, insert: string }");
            }
            if (e.from < 0 || e.from > e.to || e.to > text.length) {
              throw invalid(`edit [${e.from}, ${e.to}) is outside the text (length ${text.length})`);
            }
            text = text.slice(0, e.from) + e.insert + text.slice(e.to);
          }
          checkLength(text);
          advance(doc, p.rev);
          doc.text = text;
          return null;
        },
        "document/setFiles": (raw) => {
          const p = documentParams(raw) as DocumentSetFilesParams;
          const doc = open(p);
          const delta = fileDelta(p.files);
          // Check every path before changing anything.
          for (const path of Object.keys(delta)) {
            try {
              toVirtualPath(path);
            } catch (error) {
              throw invalid((error as Error).message);
            }
          }
          advance(doc, p.rev);
          applyFiles(doc, delta);
          return null;
        },
        "document/close": (raw) => {
          const p = documentParams(raw);
          open(p);
          documents.delete(p.uri);
          return null;
        },
        compile: async (raw, _id) => {
          const p = documentParams(raw) as CompileParams;
          if (p.target !== "html" && p.target !== "paged") {
            throw new ProtocolError("unsupported", `target ${String(p.target)} is not supported`);
          }
          const target: CompileTarget = p.target;
          const inputs = stringRecord(p.inputs, "inputs");
          const doc = current(p);
          const timeoutMs = p.mode === "final" ? timeouts.final : timeouts.streaming;
          let compiled: Compiled;
          let artifact: Artifact | undefined;
          if (target === "html") {
            compiled = await compile(engine, {
              text: doc.text,
              preamble: doc.preamble,
              files: doc.files,
              inputs,
              op: "html",
              timeoutMs,
              affinity: doc.key,
            });
            if (compiled.ok && compiled.result?.html !== undefined)
              artifact = { target: "html", html: compiled.result.html };
          } else {
            const fullPages = p.fullPages === true || !pagedDiff;
            const token = `${nextToken++}`;
            compiled = await compile(engine, {
              text: doc.text,
              preamble: doc.preamble,
              files: doc.files,
              inputs,
              op: "svg",
              timeoutMs,
              affinity: doc.key,
              baseline: fullPages ? null : (doc.paged?.token ?? null),
              token,
            });
            if (compiled.ok && documents.get(doc.uri) === doc)
              artifact = pagedArtifact(doc, compiled, token, fullPages);
          }
          // The document may have been closed while it compiled: then nothing is published.
          if (documents.get(doc.uri) === doc) {
            notify({
              method: "document/diagnostics",
              params: { uri: doc.uri, rev: p.rev, target, diagnostics: normalizeDiagnostics(compiled.diagnostics) },
            });
            if (artifact) notify({ method: "document/artifact", params: { uri: doc.uri, rev: p.rev, artifact } });
          }
          const r = compiled.result;
          const result: Omit<CompileResult, "timings"> & { timings: Partial<CompileResult["timings"]> } = {
            uri: doc.uri,
            rev: p.rev,
            target,
            status: artifact ? "ok" : "error",
            timings: {
              ...(r ? { compileMs: r.compileMs } : {}),
              ...(r?.exportMs !== undefined ? { exportMs: r.exportMs } : {}),
            },
          };
          return result;
        },
        "export/pdf": async (raw) => exportDoc(raw, "pdf"),
        "export/html": async (raw) => exportDoc(raw, "html"),
        "resolve/span": () => {
          throw new ProtocolError("unsupported", "resolve/span is not supported by this server");
        },
        "resolve/location": () => {
          throw new ProtocolError("unsupported", "resolve/location is not supported by this server");
        },
      };

      const exportDoc = async (raw: unknown, format: "pdf" | "html"): Promise<ExportResult<Uint8Array | string>> => {
        const p = documentParams(raw) as ExportParams;
        const inputs = stringRecord(p.inputs, "inputs");
        const doc = current(p);
        const compiled = await compile(engine, {
          text: doc.text,
          preamble: doc.preamble,
          files: doc.files,
          inputs,
          op: format,
          timeoutMs: timeouts.final,
          affinity: doc.key,
        });
        const diagnostics: Diagnostic[] = normalizeDiagnostics(compiled.diagnostics);
        const data = format === "pdf" ? compiled.result?.pdf : compiled.result?.html;
        return compiled.ok && data !== undefined
          ? { uri: doc.uri, rev: p.rev, diagnostics, status: "ok", data }
          : { uri: doc.uri, rev: p.rev, diagnostics, status: "error" };
      };

      const initialize = (id: RequestId, raw: unknown): void => {
        if (!isObject(raw) || typeof raw.protocolVersion !== "number" || !isObject(raw.capabilities)) {
          fail(id, "invalid-params", "expected { protocolVersion, capabilities }");
          return;
        }
        const p = raw as unknown as InitializeParams;
        if (p.protocolVersion !== PROTOCOL_VERSION) {
          fail(id, "protocol-version-mismatch", `this server speaks protocol ${PROTOCOL_VERSION}`, {
            supported: [PROTOCOL_VERSION],
          });
          return;
        }
        pagedDiff = p.capabilities.pagedDiff === true;
        state = "ready";
        const result: InitializeResult = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { targets: ["html", "paged"], exports: ["pdf", "html"], pagedDiff: true },
          serverInfo: {
            name: options.serverInfo?.name ?? "@typstream/node",
            ...(options.serverInfo?.version ? { version: options.serverInfo.version } : {}),
            typstVersion: TYPST_VERSION,
          },
        };
        emit({ id, result });
      };

      /** Requests run one at a time, in arrival order, so edits and compiles of a document never interleave. */
      const pump = async (): Promise<void> => {
        if (running) return;
        running = true;
        while (queue.length > 0 && state !== "closed") {
          const { request, t0 } = queue.shift() as { request: Request; t0: number };
          const { id, method } = request;
          if (cancelled.delete(id)) {
            fail(id, "request-cancelled", `request ${id} was cancelled`);
            continue;
          }
          if (state === "shut-down") {
            fail(id, "not-initialized", "the server has shut down");
            continue;
          }
          if (method === "initialize" && state === "new") {
            initialize(id, request.params);
            continue;
          }
          if (state === "new") {
            fail(id, "not-initialized", "send initialize first");
            continue;
          }
          const handler = handlers[method];
          try {
            const result = await handler(request.params, id);
            if (method === "compile" && isObject(result)) {
              (result.timings as Record<string, number>).totalMs = performance.now() - t0;
            }
            emit({ id, result } as ServerMessage);
          } catch (error) {
            if (error instanceof ProtocolError) emit({ id, error: error.toJSON() });
            else fail(id, "internal", error instanceof Error ? error.message : String(error));
          }
        }
        running = false;
      };

      return {
        receive(message) {
          if (state === "closed") return;
          if (!isObject(message) || typeof message.method !== "string") {
            if (isObject(message) && typeof message.id === "number")
              fail(message.id, "invalid-params", "malformed message");
            else notify({ method: "$/log", params: { level: "warn", message: "ignored a malformed message" } });
            return;
          }
          const m = message as ClientMessage;
          if (!("id" in m)) {
            if (m.method === "$/cancel" && isObject(m.params) && typeof m.params.id === "number") {
              // Only requests that haven't started can be dropped.
              if (queue.some((q) => q.request.id === m.params.id)) cancelled.add(m.params.id);
            }
            return;
          }
          if (typeof m.id !== "number") return;
          if (!(m.method in handlers)) return fail(m.id, "method-not-found", `unknown method ${m.method}`);
          queue.push({ request: m, t0: performance.now() });
          void pump();
        },
        close() {
          state = "closed";
          queue.length = 0;
          documents.clear();
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
  send(data: string): void;
  close(code?: number, reason?: string): void;
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
 * format (`serializeMessage` from `@typstream/core`); replies go back the same way.
 *
 * @example
 * ```ts
 * import { WebSocketServer } from "ws";
 * const server = createProtocolServer();
 * new WebSocketServer({ port: 8080 }).on("connection", (ws) => handleWebSocket(ws, server));
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
