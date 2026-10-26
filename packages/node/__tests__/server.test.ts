// The protocol server: @typstream/engine's conformance suite (#10) in-process
// and over a real WebSocket, then what is particular to serving it from Node:
// the pool's watchdog, budgets per mode, untrusted input, limits and sessions.

import type { AddressInfo } from "node:net";
import {
  deserializeMessage,
  type PagedArtifact,
  type ServerMessage,
  type ServerNotification,
  serializeMessage,
} from "@typstream/core";
import type { SpawnEngine } from "@typstream/engine/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { conformance } from "../../engine/__tests__/conformance";
import { createEngine, createProtocolServer, handleWebSocket, type ProtocolServer } from "../src";
import { inProcess, overWebSocket, TestClient } from "./support/client";

const engine = createEngine({ workers: 2 });
const server = createProtocolServer({ engine, timeouts: { streaming: 1_500, final: 30_000 } });
let wss: WebSocketServer;
let url = "";

beforeAll(async () => {
  wss = await new Promise<WebSocketServer>((resolve) => {
    const s: WebSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 }, () => resolve(s));
  });
  wss.on("connection", (ws) => handleWebSocket(ws, server));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await engine.close();
});

/** A connection to `s` as a SpawnEngine, through core's codec, delivered on later tasks like a worker's. */
const spawnInProcess =
  (s: ProtocolServer): SpawnEngine =>
  (events) => {
    let alive = true;
    const conn = s.connect((m) => {
      const copy = deserializeMessage(serializeMessage(m)) as ServerMessage;
      setTimeout(() => alive && events.message(copy));
    });
    return {
      postMessage: (m) => {
        const copy = deserializeMessage(serializeMessage(m));
        setTimeout(() => alive && conn.receive(copy));
      },
      terminate: () => {
        alive = false;
        conn.close();
      },
    };
  };

/** A WebSocket client as a SpawnEngine; messages wait for the socket to open. */
const spawnWebSocket = (): SpawnEngine => (events) => {
  const ws = new WebSocket(url);
  const early: string[] = [];
  ws.on("open", () => {
    for (const m of early.splice(0)) ws.send(m);
  });
  ws.on("message", (data) => events.message(deserializeMessage(String(data)) as ServerMessage));
  ws.on("error", (error) => events.error(error));
  return {
    postMessage: (m) => {
      const text = serializeMessage(m);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else early.push(text);
    },
    terminate: () => ws.close(),
  };
};

conformance("@typstream/node, in process", () => spawnInProcess(server));
conformance("@typstream/node, over WebSocket", spawnWebSocket);

// 400 million iterations over small ranges: pure CPU, nothing for wasm's memory cap to catch.
// (A single `range(400000000)` would allocate 400M values and trap first.)
const RUNAWAY = "#let n = 0\n#for a in range(20000) { for b in range(20000) { n += 1 } }\n#n";
const PAGES = (n: number): string =>
  `#set page(width: 10cm, height: 6cm)\n${Array.from({ length: n }, (_, i) => `= Page ${i + 1}`).join("\n#pagebreak()\n")}`;

const diagnosticsOf = (c: TestClient, rev: number) =>
  c
    .notifications()
    .filter((n): n is ServerNotification<"document/diagnostics"> => n.method === "document/diagnostics")
    .filter((n) => n.params.rev === rev)
    .map((n) => n.params.diagnostics);

const pagedOf = (c: TestClient, uri: string, rev: number): PagedArtifact | undefined =>
  c
    .notifications()
    .filter((n): n is ServerNotification<"document/artifact"> => n.method === "document/artifact")
    .filter((n) => n.params.uri === uri && n.params.rev === rev)
    .map((n) => n.params.artifact)
    .filter((a): a is PagedArtifact => a.target === "paged")
    .at(-1);

const ready = async (s: ProtocolServer = server): Promise<TestClient> => {
  const c = new TestClient(inProcess(s));
  await c.initialize();
  return c;
};

describe("serving from Node", () => {
  it("stops a runaway streaming compile with its budget and keeps serving the document", async () => {
    const c = await ready();
    await c.request("document/open", { uri: "a", rev: 1, text: RUNAWAY });
    const t0 = performance.now();
    expect((await c.request("compile", { uri: "a", rev: 1, target: "html" })).status).toBe("error");
    expect(performance.now() - t0).toBeLessThan(5_000);
    expect(diagnosticsOf(c, 1)[0]).toMatchObject([{ code: "timeout", source: "typstream" }]);
    await c.request("document/edit", { uri: "a", rev: 2, edits: [{ from: 0, to: RUNAWAY.length, insert: "fine" }] });
    expect((await c.request("compile", { uri: "a", rev: 2, target: "html" })).status).toBe("ok");
    c.close();
  });

  it("gives final compiles the final budget", async () => {
    const strict = createProtocolServer({ engine, timeouts: { streaming: 30_000, final: 500 } });
    const c = await ready(strict);
    await c.request("document/open", { uri: "a", rev: 1, text: RUNAWAY });
    await c.request("compile", { uri: "a", rev: 1, target: "html", mode: "final" });
    expect(diagnosticsOf(c, 1)[0]?.[0]?.message).toBe("compiling took longer than 500 ms and was stopped");
    c.close();
  });

  it("exports PDF", async () => {
    const c = await ready();
    await c.request("document/open", { uri: "a", rev: 1, text: PAGES(2) });
    const pdf = await c.request("export/pdf", { uri: "a", rev: 1 });
    expect(pdf.status).toBe("ok");
    expect(pdf.status === "ok" && new TextDecoder().decode(pdf.data.slice(0, 5))).toBe("%PDF-");
    c.close();
  });

  it("diffs pages per document, whichever worker compiles them", async () => {
    const c = await ready();
    // Two documents compiled in turn on a 2-worker pool: workers' baselines get replaced
    // by the other document's, and pages still diff against what the client holds.
    for (const uri of ["a", "b"]) await c.request("document/open", { uri, rev: 1, text: PAGES(3) });
    for (const uri of ["a", "b"]) await c.request("compile", { uri, rev: 1, target: "paged" });
    for (const uri of ["a", "b"]) {
      const text = `${PAGES(3)} more`;
      await c.request("document/edit", { uri, rev: 2, edits: [{ from: 0, to: PAGES(3).length, insert: text }] });
      await c.request("compile", { uri, rev: 2, target: "paged" });
      expect(pagedOf(c, uri, 2)).toMatchObject({ base: 1, pageCount: 3 });
      expect(pagedOf(c, uri, 2)?.pages.map((p) => p.index)).toEqual([2]);
    }
    c.close();
  });

  it("answers malformed requests with invalid-params and keeps going", async () => {
    const c = await ready();
    expect(await c.errorOf("document/open", { uri: 3, rev: "x" } as never)).toBe("invalid-params");
    expect(await c.errorOf("document/edit", { uri: "a", rev: 2, edits: [{ from: "0" }] } as never)).toBe(
      "invalid-params",
    );
    expect(await c.errorOf("compile", { uri: "a", rev: 1, target: "html", inputs: { n: 1 } } as never)).toBe(
      "invalid-params",
    );
    expect(await c.errorOf("document/open", { uri: "a", rev: 1, text: "", files: { "../x": "" } })).toBe(
      "invalid-params",
    );
    await c.request("document/open", { uri: "a", rev: 1, text: "ok" });
    expect((await c.request("compile", { uri: "a", rev: 1, target: "html" })).status).toBe("ok");
    c.close();
  });

  it("limits documents per connection and their size", async () => {
    const small = createProtocolServer({ engine, maxDocuments: 2, maxTextLength: 100 });
    const c = await ready(small);
    await c.request("document/open", { uri: "a", rev: 1, text: "x" });
    await c.request("document/open", { uri: "b", rev: 1, text: "x".repeat(200) });
    expect(await c.errorOf("document/open", { uri: "c", rev: 1, text: "" })).toBe("invalid-params");
    expect(await c.errorOf("compile", { uri: "b", rev: 1, target: "html" })).toBe("invalid-params");
    await c.request("document/close", { uri: "a", rev: 1 });
    await c.request("document/open", { uri: "c", rev: 1, text: "" });
    c.close();
  });

  it("isolates sessions: documents are per connection", async () => {
    const a = await ready();
    const b = await ready();
    await a.request("document/open", { uri: "doc", rev: 1, text: "A" });
    expect(await b.errorOf("compile", { uri: "doc", rev: 1, target: "html" })).toBe("document-not-open");
    await b.request("document/open", { uri: "doc", rev: 1, text: "B" });
    a.close();
    b.close();
  });

  it("drops queued requests and documents when the client goes away", async () => {
    const sent: ServerMessage[] = [];
    const conn = server.connect((m) => sent.push(m));
    conn.receive({ id: 1, method: "initialize", params: { protocolVersion: 1, capabilities: {} } });
    conn.receive({ id: 2, method: "document/open", params: { uri: "a", rev: 1, text: PAGES(2) } });
    conn.receive({ id: 3, method: "compile", params: { uri: "a", rev: 1, target: "paged" } });
    conn.close();
    conn.receive({ id: 4, method: "shutdown", params: null });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sent).toEqual([]);
  });
});

describe("WebSocket transport", () => {
  it("logs and survives text that isn't JSON", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => ws.once("open", resolve));
    const reply = new Promise<string>((resolve) => ws.once("message", (data) => resolve(String(data))));
    ws.send("{not json");
    expect(deserializeMessage(await reply)).toEqual({
      method: "$/log",
      params: { level: "warn", message: "ignored a message that isn't JSON" },
    });
    ws.close();
  });

  it("logs and survives JSON that isn't a protocol message", async () => {
    const c = new TestClient(await overWebSocket(url));
    c.send("just a string");
    await c.initialize();
    expect(c.notifications()).toContainEqual({
      method: "$/log",
      params: { level: "warn", message: "ignored a malformed message" },
    });
    c.close();
  });

  it("frees a session when the socket closes", async () => {
    const before = wss.clients.size;
    const c = new TestClient(await overWebSocket(url));
    await c.initialize();
    await c.request("document/open", { uri: "a", rev: 1, text: "x" });
    c.close();
    await expect.poll(() => wss.clients.size).toBe(before);
  });
});
