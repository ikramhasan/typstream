// engineWorker() under Trusted Types (#70): the worker's URL goes through the
// `typstream` policy, and the global Worker is left as it was. Stand-ins for
// the DOM's Worker and trustedTypes; examples/strict-csp checks real browsers.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineEvents } from "../src/connection";

const noop: EngineEvents = { message: () => {}, error: () => {}, lost: () => {} };

/** A Worker that records the URL it was given. */
const stubWorker = () => {
  const urls: unknown[] = [];
  class Worker {
    constructor(url: unknown) {
      urls.push(url);
    }
    postMessage() {}
    terminate() {}
    addEventListener() {}
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
});
