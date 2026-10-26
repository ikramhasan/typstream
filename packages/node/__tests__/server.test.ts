import type { AddressInfo } from "node:net";
import { deserializeMessage } from "@typstream/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createEngine, createProtocolServer, handleWebSocket } from "../src";
import { inProcess, overWebSocket, TestClient } from "./support/client";
import { describeConformance } from "./support/conformance";

const engine = createEngine({ workers: 2 });
const server = createProtocolServer({ engine, timeouts: { streaming: 1_500 } });
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

// 400 million iterations over small ranges: pure CPU, nothing for wasm's memory cap to catch.
// (A single `range(400000000)` would allocate 400M values and trap first.)
const RUNAWAY = "#let n = 0\n#for a in range(20000) { for b in range(20000) { n += 1 } }\n#n";

describeConformance("in-process", { connect: async () => inProcess(server), runaway: RUNAWAY });
describeConformance("WebSocket", { connect: () => overWebSocket(url) });

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

  it("frees a session's documents when the socket closes", async () => {
    const before = wss.clients.size;
    const c = new TestClient(await overWebSocket(url));
    await c.initialize();
    await c.request("document/open", { uri: "a", rev: 1, text: "x" });
    c.close();
    await expect.poll(() => wss.clients.size).toBe(before);
  });
});
