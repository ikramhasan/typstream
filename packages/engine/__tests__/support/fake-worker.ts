// A fake engine worker: speaks the protocol from @typstream/core, keeps each
// document's text by applying the client's edits, and "compiles" it on the
// (fake) clock. Like a real worker it handles one message at a time, in order.
// Markers in the text script what a compile does:
//
//   ERROR  → an error diagnostic on the marker, status "error", no artifact
//   LOOP   → never finishes (only the watchdog gets the client out)
//   CRASH  → the worker fails outside the protocol (an `error` event)
//
// A compile's `fallback.skip` ranges are replaced with `[skipped:<reason>]`
// first, as the server shows them as error blocks without compiling them.
//
// Paged artifacts have one page per paragraph (split on blank lines) and send
// only changed pages, diffing against the previous paged artifact. Exports
// follow the same markers; a PDF is the bytes of `%PDF ` and the text.

import {
  applyEdit,
  type ClientMessage,
  type CompileParams,
  type CompileResult,
  type Diagnostic,
  type ExportFormat,
  type ExportParams,
  type ExportResult,
  type InitializeResult,
  isRequest,
  type PageUpdate,
  PROTOCOL_VERSION,
  type Request,
  type Response,
  type ServerMessage,
} from "@typstream/core";
import type { EngineConnection, EngineEvents, SpawnEngine } from "../../src/connection";

export interface FakeOptions {
  /** Time a compile takes, by text. Default 10 ms. */
  compileMs?: (text: string) => number;
  /** Time `initialize` takes. Default 50 ms. */
  initMs?: number;
  /** Reported after each compile. */
  memoryBytes?: (compiles: number) => number | undefined;
  /** `initialize` answers with this protocol version. */
  protocolVersion?: number;
  /** The export formats offered. Default HTML and PDF. */
  exports?: ExportFormat[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface FakeDoc {
  rev: number;
  text: string;
  pages: PageUpdate[] | null;
  pagesRev: number | null;
}

export class FakeWorker implements EngineConnection {
  readonly received: ClientMessage[] = [];
  /** `Date.now()` (fake under fake timers) when each message in `received` arrived. */
  readonly receivedAt: number[] = [];
  terminated = false;
  compiles = 0;
  /** Compile requests answered or still running; at most one runs at a time. */
  running = 0;
  maxRunning = 0;
  readonly docs = new Map<string, FakeDoc>();
  private chain: Promise<void> = Promise.resolve();
  private readonly cancelled = new Set<number>();

  constructor(
    private readonly events: EngineEvents,
    private readonly options: FakeOptions,
  ) {}

  postMessage(message: ClientMessage): void {
    if (this.terminated) throw new Error("postMessage on a terminated worker");
    // Structured clone, as postMessage does.
    const m = structuredClone(message);
    this.received.push(m);
    this.receivedAt.push(Date.now());
    if (!isRequest(m)) {
      if (m.method === "$/cancel") this.cancelled.add(m.params.id);
      return;
    }
    this.chain = this.chain.then(() => this.handle(m));
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Posts a message to the client as the worker would (asynchronously, unless terminated). */
  post(message: ServerMessage): void {
    if (!this.terminated) this.events.message(structuredClone(message));
  }

  /** When each compile request arrived. */
  compileTimes(): number[] {
    return this.received.flatMap((m, i) => (isRequest(m) && m.method === "compile" ? [this.receivedAt[i] ?? 0] : []));
  }

  requests(method?: string): Request[] {
    return this.received.filter((m): m is Request => isRequest(m) && (method === undefined || m.method === method));
  }

  private respond(response: Response): void {
    this.post(response);
  }

  private async handle(req: Request): Promise<void> {
    if (this.terminated) return;
    if (this.cancelled.has(req.id)) {
      return this.respond({ id: req.id, error: { code: "request-cancelled", message: "cancelled" } });
    }
    switch (req.method) {
      case "initialize": {
        await sleep(this.options.initMs ?? 50);
        const result: InitializeResult = {
          protocolVersion: this.options.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: {
            targets: ["html", "paged"],
            exports: this.options.exports ?? ["html", "pdf"],
            pagedDiff: true,
          },
          serverInfo: { name: "fake", typstVersion: "0.15.1" },
        };
        return this.respond({ id: req.id, result });
      }
      case "document/open": {
        const p = req.params;
        if (this.docs.has(p.uri)) {
          return this.respond({ id: req.id, error: { code: "document-already-open", message: p.uri } });
        }
        this.docs.set(p.uri, { rev: p.rev, text: p.text, pages: null, pagesRev: null });
        return this.respond({ id: req.id, result: null });
      }
      case "document/edit": {
        const doc = this.docs.get(req.params.uri);
        if (!doc) return this.respond({ id: req.id, error: { code: "document-not-open", message: "" } });
        if (req.params.rev <= doc.rev) {
          return this.respond({ id: req.id, error: { code: "stale-revision", message: "" } });
        }
        doc.text = req.params.edits.reduce(applyEdit, doc.text);
        doc.rev = req.params.rev;
        return this.respond({ id: req.id, result: null });
      }
      case "document/setFiles": {
        const doc = this.docs.get(req.params.uri);
        if (doc) doc.rev = req.params.rev;
        return this.respond({ id: req.id, result: null });
      }
      case "document/close":
        this.docs.delete(req.params.uri);
        return this.respond({ id: req.id, result: null });
      case "compile":
        return this.compile(req.id, req.params);
      case "export/pdf":
        return this.export(req.id, "pdf", req.params);
      case "export/html":
        return this.export(req.id, "html", req.params);
      default:
        return this.respond({ id: req.id, error: { code: "method-not-found", message: req.method } });
    }
  }

  /** Runs a compile or export of `text`: false if it never finishes (LOOP, CRASH). */
  private async work(text: string): Promise<boolean> {
    if (text.includes("CRASH")) {
      await sleep(1);
      this.events.error(new Error("worker crashed"));
      return false;
    }
    if (text.includes("LOOP")) return false;
    await sleep(this.options.compileMs?.(text) ?? 10);
    return !this.terminated;
  }

  private errors(text: string): Diagnostic[] {
    const at = text.indexOf("ERROR");
    return at < 0
      ? []
      : [
          {
            severity: "error",
            span: { from: at, to: at + 5 },
            message: "unknown variable: ERROR",
            hints: [],
            trace: [],
          },
        ];
  }

  private async export(id: number, format: ExportFormat, p: ExportParams): Promise<void> {
    const doc = this.docs.get(p.uri);
    if (!doc) return this.respond({ id, error: { code: "document-not-open", message: p.uri } });
    if (p.rev !== doc.rev) return this.respond({ id, error: { code: "content-modified", message: "" } });
    if (!(this.options.exports ?? ["html", "pdf"]).includes(format)) {
      return this.respond({ id, error: { code: "unsupported", message: `fake doesn't support ${format} export` } });
    }
    const text = doc.text;
    if (!(await this.work(text))) return new Promise(() => {});
    const diagnostics = this.errors(text);
    const data =
      format === "pdf" ? new TextEncoder().encode(`%PDF ${text}`) : `<html><body><p>${text}</p></body></html>`;
    const result: ExportResult<Uint8Array | string> =
      diagnostics.length > 0
        ? { uri: p.uri, rev: p.rev, diagnostics, status: "error" }
        : { uri: p.uri, rev: p.rev, diagnostics, status: "ok", data };
    this.respond({ id, result } as Response);
  }

  private async compile(id: number, p: CompileParams): Promise<void> {
    const doc = this.docs.get(p.uri);
    if (!doc) return this.respond({ id, error: { code: "document-not-open", message: p.uri } });
    if (p.rev !== doc.rev) return this.respond({ id, error: { code: "content-modified", message: "" } });
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    const text = [...(p.fallback?.skip ?? [])]
      .reverse()
      .reduce((t, r) => `${t.slice(0, r.from)}[skipped:${r.reason}]${t.slice(r.to)}`, doc.text);
    if (!(await this.work(text))) return new Promise(() => {});
    this.running--;
    this.compiles++;
    const diagnostics = this.errors(text);
    this.post({ method: "document/diagnostics", params: { uri: p.uri, rev: p.rev, target: p.target, diagnostics } });
    const ok = diagnostics.length === 0;
    if (ok && p.target === "html") {
      this.post({
        method: "document/artifact",
        params: { uri: p.uri, rev: p.rev, artifact: { target: "html", html: `<p>${text}</p>` } },
      });
    } else if (ok) {
      const pages = text
        .split("\n\n")
        .map((part, index) => ({ index, hash: part, width: 595, height: 842, svg: part }));
      const base = p.fullPages || !doc.pages ? null : doc.pagesRev;
      const changed = base === null ? pages : pages.filter((page) => doc.pages?.[page.index]?.hash !== page.hash);
      doc.pages = pages;
      doc.pagesRev = p.rev;
      this.post({
        method: "document/artifact",
        params: {
          uri: p.uri,
          rev: p.rev,
          artifact: { target: "paged", base, pageCount: pages.length, pages: changed },
        },
      });
    }
    const result: CompileResult = {
      uri: p.uri,
      rev: p.rev,
      target: p.target,
      status: ok ? "ok" : "error",
      timings: { totalMs: this.options.compileMs?.(text) ?? 10 },
    };
    const memoryBytes = this.options.memoryBytes?.(this.compiles);
    if (memoryBytes !== undefined) result.memoryBytes = memoryBytes;
    this.respond({ id, result });
  }
}

/** Spawns fake workers and keeps every one it spawned, oldest first. */
export class FakeWorkers {
  readonly spawned: FakeWorker[] = [];

  constructor(readonly options: FakeOptions = {}) {}

  readonly spawn: SpawnEngine = (events) => {
    const worker = new FakeWorker(events, this.options);
    this.spawned.push(worker);
    return worker;
  };

  /** Workers not terminated, oldest first: the active one, then the spare. */
  get alive(): FakeWorker[] {
    return this.spawned.filter((w) => !w.terminated);
  }

  /** Every compile request, in every worker. */
  compileRequests(): CompileParams[] {
    return this.spawned.flatMap((w) => w.requests("compile").map((r) => r.params as CompileParams));
  }
}
