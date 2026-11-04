// engineWorker() under Trusted Types (#70): the worker's URL goes through the
// `typstream` policy, and the global Worker is left as it was. Stand-ins for
// the DOM's Worker and trustedTypes; examples/strict-csp checks real browsers.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineEvents } from "../src/connection";
import { wasmMessage, wasmOf } from "../src/shared-wasm";

const noop: EngineEvents = { message: () => {}, error: () => {}, lost: () => {} };

/** A Worker that records the URL it was given and what it was sent, and can post messages back. */
const stubWorker = () => {
  const urls: unknown[] = [];
  class Worker {
    readonly sent: unknown[] = [];
    private readonly listeners: ((event: { data: unknown }) => void)[] = [];
    constructor(url: unknown) {
      urls.push(url);
    }
    postMessage(message: unknown) {
      this.sent.push(message);
    }
    terminate() {}
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      if (type === "message") this.listeners.push(listener);
    }
    /** The worker posts `data` to the page. */
    post(data: unknown) {
      for (const listener of this.listeners) listener({ data });
    }
  }
  vi.stubGlobal("Worker", Worker);
  return { Worker, urls };
};

// The policy is created once per module, so each test loads a fresh copy.
const load = async () => {
  vi.resetModules();
  return (await import("../src/spawn")).engineWorker;
};

afterEach(() => vi.unstubAllGlobals());

describe("engineWorker", () => {
  it("passes the worker's URL as is without Trusted Types", async () => {
    const { Worker, urls } = stubWorker();
    const worker = (await load())()(noop);
    expect(worker).toBeInstanceOf(Worker);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBeInstanceOf(URL);
    expect(String(urls[0])).toMatch(/\/worker\.js$/);
  });

  it("passes it through the typstream policy with Trusted Types, and restores Worker", async () => {
    const { Worker, urls } = stubWorker();
    const names: string[] = [];
    vi.stubGlobal("trustedTypes", {
      createPolicy: (name: string, rules: { createScriptURL(s: string): string }) => {
        names.push(name);
        return { createHTML: () => null, createScriptURL: (s: string) => ({ trusted: rules.createScriptURL(s) }) };
      },
    });
    const spawn = (await load())();
    expect(spawn(noop)).toBeInstanceOf(Worker);
    expect(spawn(noop)).toBeInstanceOf(Worker);
    expect(urls).toEqual([
      { trusted: expect.stringMatching(/\/worker\.js$/) },
      { trusted: expect.stringMatching(/\/worker\.js$/) },
    ]);
    expect(names).toEqual(["typstream"]);
    expect(globalThis.Worker).toBe(Worker);
  });

  it("gives the engine the first worker compiled to every worker after it, and keeps it from the client", async () => {
    stubWorker();
    const spawn = (await load())();
    const received: unknown[] = [];
    const events: EngineEvents = { ...noop, message: (m) => received.push(m) };
    type Stub = InstanceType<ReturnType<typeof stubWorker>["Worker"]>;
    const first = spawn(events) as unknown as Stub;
    expect(first.sent).toEqual([]);
    // An empty module: the 8-byte header.
    const module = new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    first.post(wasmMessage(module));
    first.post({ id: 1, result: {} });
    expect(received).toEqual([{ id: 1, result: {} }]);
    const second = spawn(events) as unknown as Stub;
    expect(second.sent).toHaveLength(1);
    expect(wasmOf(second.sent[0])).toBe(module);
  });
});
