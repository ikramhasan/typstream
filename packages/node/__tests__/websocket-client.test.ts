// `@typstream/engine/websocket` (#85), the client's transport to this server:
// the engine client on a real WebSocket (Node's global one, as in a browser)
// to `handleWebSocket`. Previews, exports, the client's watchdog closing the
// connection, and connections that drop, fail to open, or are refused.

import type { AddressInfo } from "node:net";
import type { HtmlArtifact, PagedArtifact } from "@typstream/core";
import {
  createEngine as createClient,
  type Engine,
  type EngineDocument,
  type EngineEvent,
  type EngineOptions,
} from "@typstream/engine";
import { fromWebSocket, WEBSOCKET_DEFAULTS, type WebSocketOptions } from "@typstream/engine/websocket";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { createEngine, createProtocolServer, handleWebSocket, type ProtocolServer } from "../src";

const engine = createEngine({ workers: 2 });
let server: ProtocolServer = createProtocolServer({ engine });
let wss: WebSocketServer;
let url = "";
/** Runs on each new connection before `handleWebSocket`; tests replace it. */
let onConnection: (ws: WebSocket) => void = () => {};

beforeAll(async () => {
  wss = await new Promise<WebSocketServer>((resolve) => {
    const s: WebSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 }, () => resolve(s));
  });
  wss.on("connection", (ws) => {
    onConnection(ws);
    handleWebSocket(ws, server);
  });
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});

const clients: Engine[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose();
  // Tests count the server's connections: wait for these to close.
  await expect.poll(() => wss.clients.size).toBe(0);
  server = createProtocolServer({ engine });
  onConnection = () => {};
});

afterAll(async () => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await engine.close();
});

const RUNAWAY = "#let n = 0\n#for a in range(20000) { for b in range(20000) { n += 1 } }\n#n";
const PAGES = (n: number): string =>
  `#set page(width: 10cm, height: 6cm)\n${Array.from({ length: n }, (_, i) => `= Page ${i + 1}`).join("\n#pagebreak()\n")}`;

/** An engine client on `url`, its events recorded. */
const connect = (options: Partial<EngineOptions> = {}, socket: WebSocketOptions = {}, at = url) => {
  const client = createClient({ spawn: fromWebSocket(at, socket), ...options });
  clients.push(client);
  const events: EngineEvent[] = [];
  client.onEvent((e) => events.push(e));
  return { client, events };
};

const status = (doc: EngineDocument, expected: string, timeout = 30_000) =>
  expect.poll(() => doc.getState().status, { timeout }).toBe(expected);

/** Streams `text` in chunks and finishes it. */
const stream = (doc: EngineDocument, text: string): void => {
  for (let i = 0; i < text.length; i += 7) doc.push(text.slice(i, i + 7));
  doc.finish();
};

describe("fromWebSocket on @typstream/node's server", () => {
  it("renders paged previews with changed-page updates", async () => {
    const { client, events } = connect();
    const info = await client.ready;
    expect(info.serverInfo.name).toBe("@typstream/node");
    const doc = client.open({ target: "paged" });
    stream(doc, PAGES(3));
    await status(doc, "done");
    const pages = doc.getState().artifact as PagedArtifact;
    expect(pages.pageCount).toBe(3);
    expect(pages.pages.every((p) => p.svg.startsWith("<svg"))).toBe(true);
    // One connection, no spare; nothing went wrong on the way.
    expect(wss.clients.size).toBe(1);
    expect(events.filter((e) => e.type !== "ready" && e.type !== "document")).toEqual([]);
  });

  it("renders HTML previews while streaming and when finished", async () => {
    const { client } = connect();
    const doc = client.open({ target: "html" });
    doc.push("= Fractions\n\nAdd *one");
    await expect
      .poll(() => (doc.getState().artifact as HtmlArtifact | null)?.html ?? "")
      .toContain("<strong>one</strong>");
    doc.push(" half* and one third.");
    doc.finish();
    await status(doc, "done");
    const html = (doc.getState().artifact as HtmlArtifact).html;
    expect(html).toContain("Fractions");
    expect(html).toContain("one third");
  });

  it("exports PDF and HTML", async () => {
    const { client } = connect();
    const doc = client.open({ target: "html", text: PAGES(2) });
    doc.finish();
    const pdf = await doc.exportPdf();
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(await doc.exportHtml()).toContain("Page 2");
  });

  it("lets the server's timeout answer first with the default budgets", async () => {
    const { client, events } = connect();
    expect(fromWebSocket(url).defaults).toBe(WEBSOCKET_DEFAULTS);
    const doc = client.open({ target: "html" });
    doc.push(RUNAWAY);
    // The server stops the compile at its 3 s and answers; the client's 10 s never runs out.
    await expect.poll(() => doc.getState().diagnostics.map((d) => d.code), { timeout: 15_000 }).toContain("timeout");
    expect(events.some((e) => e.type === "watchdog" || e.type === "disconnect")).toBe(false);
    expect(doc.getState().failure?.reason).toBe("diagnostics");
    expect(wss.clients.size).toBe(1);
  });

  it("closes the connection when its own watchdog runs out, and opens another", async () => {
    // The server would wait 4 s; the client gives up at 1 s.
    server = createProtocolServer({ engine, timeouts: { streaming: 4_000 } });
    const { client, events } = connect({ watchdog: { streamingMs: 1_000 } });
    await client.ready;
    const doc = client.open({ target: "html" });
    doc.push(RUNAWAY);
    await expect
      .poll(() => events.find((e) => e.type === "watchdog"), { timeout: 10_000 })
      .toMatchObject({
        budgetMs: 1_000,
      });
    expect(doc.getState().failure?.reason).toBe("timeout");
    // A new session is open and the old one is gone.
    await expect.poll(() => events.filter((e) => e.type === "ready")).toHaveLength(2);
    await expect.poll(() => wss.clients.size).toBe(1);
    doc.set("= Fine");
    doc.finish();
    await status(doc, "done");
    expect((doc.getState().artifact as HtmlArtifact).html).toContain("Fine");
  });

  it("opens a new connection when one drops, and reopens its documents there", async () => {
    const { client, events } = connect();
    const doc = client.open({ target: "html", text: "= One" });
    await expect.poll(() => (doc.getState().artifact as HtmlArtifact | null)?.html ?? "").toContain("One");
    for (const ws of wss.clients) ws.terminate();
    await expect.poll(() => events.filter((e) => e.type === "ready")).toHaveLength(2);
    expect(events.find((e) => e.type === "disconnect")).toMatchObject({
      error: { message: expect.stringMatching(/^the connection to the engine at ws:.* closed \(1006\)$/) },
    });
    doc.set("= Two");
    doc.finish();
    await status(doc, "done");
    expect((doc.getState().artifact as HtmlArtifact).html).toContain("Two");
    expect(doc.getState().failure).toBeNull();
  });

  it("retries an export whose connection drops", async () => {
    let drop = true;
    onConnection = (ws) =>
      ws.on("message", (data) => {
        if (drop && String(data).includes('"export/pdf"')) {
          drop = false;
          ws.terminate();
        }
      });
    const { client, events } = connect();
    const doc = client.open({ target: "html", text: PAGES(2) });
    doc.finish();
    const pdf = await doc.exportPdf();
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(events.filter((e) => e.type === "disconnect")).toHaveLength(1);
  });

  it("retries opening a connection, then fails the engine", async () => {
    // A port nothing listens on.
    const closed = await new Promise<WebSocketServer>((resolve) => {
      const s: WebSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 }, () => resolve(s));
    });
    const at = `ws://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const { client, events } = connect({}, { retries: 2, retryDelayMs: 50 }, at);
    const doc = client.open({ target: "html", text: "x" });
    const t0 = performance.now();
    await expect(client.ready).rejects.toThrow();
    // 50 + 100 ms of backoff between three attempts.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(150);
    expect(doc.getState().status).toBe("error");
    expect(doc.getState().failure?.message).toBe(`could not connect to the engine at ${at} (1006)`);
    expect(events.find((e) => e.type === "failed")).toBeDefined();
  });

  it("fails the engine, without reconnecting, when the server closes before initialize", async () => {
    let connections = 0;
    onConnection = (ws) => {
      connections++;
      ws.close(1008, "not signed in");
    };
    const { client, events } = connect();
    await expect(client.ready).rejects.toThrow();
    expect(events.find((e) => e.type === "failed")).toMatchObject({
      error: { message: expect.stringMatching(/closed \(1008, not signed in\)$/) },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(connections).toBe(1);
  });

  it("asks a URL function for each connection", async () => {
    const asked: string[] = [];
    const spawn = fromWebSocket(() => {
      asked.push(`token-${asked.length + 1}`);
      return `${url}/?token=${asked.at(-1)}`;
    });
    const paths: string[] = [];
    wss.once("connection", (_ws, req) => paths.push(req.url ?? ""));
    const client = createClient({ spawn });
    clients.push(client);
    await client.ready;
    expect(paths).toEqual(["/?token=token-1"]);
    wss.once("connection", (_ws, req) => paths.push(req.url ?? ""));
    for (const ws of wss.clients) ws.terminate();
    await expect.poll(() => paths).toEqual(["/?token=token-1", "/?token=token-2"]);
  });
});
