/// <reference lib="dom" />
// mountTypstream without a framework, in each browser, on the real engine
// worker: options applied with update(), files changed in place, a failing
// stream, and destroy(). @typstream/react's browser tests cover the rest
// through <Typstream>.

import type { DocumentState, Engine } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { type MountedTypstream, mountTypstream, type TypstreamOptions } from "../../src/mount";
import { startEngine } from "../support/html";

const browser = server.browser;

let engine: Engine;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
}, 60_000);
afterAll(() => engine.dispose());

const host = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

/** Resolves with the first state that satisfies `done`. */
const until = (view: MountedTypstream, done: (s: DocumentState) => boolean, ms = 30_000) =>
  new Promise<DocumentState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; status ${view.getState()?.status}`)), ms);
    const check = () => {
      const s = view.getState();
      if (!s || !done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = view.subscribe(check);
    check();
  });

const settled = (s: DocumentState) => s.status === "done" || s.status === "error";

describe(`mountTypstream in ${browser}`, () => {
  it("follows a growing source, finishes it, and cleans up on destroy", async () => {
    const el = host();
    const options = (source: string, isStreaming: boolean): TypstreamOptions => ({
      engine,
      source,
      isStreaming,
      lazy: false,
      caret: true,
    });
    const view = mountTypstream(el, options("= Title\n", true));
    view.update(options("= Title\nFirst *para", true));
    await until(view, (s) => !!s.artifact && s.status === "idle");
    expect(el.querySelector(".typstream-caret")).not.toBeNull();
    view.update(options("= Title\nFirst *paragraph*.", false));
    const final = await until(view, settled);
    expect(final.status).toBe("done");
    expect(el.textContent).toContain("First paragraph.");
    expect(el.querySelector(".typstream-caret")).toBeNull();
    view.destroy();
    expect(el.childElementCount).toBe(0);
    expect(view.document).toBeNull();
    el.remove();
  });

  it("changes files in place, without reopening the document", async () => {
    const el = host();
    const options = (data: string): TypstreamOptions => ({
      engine,
      source: '#read("data.txt")',
      files: { "data.txt": data },
      lazy: false,
    });
    const view = mountTypstream(el, options("one"));
    await until(view, (s) => s.status === "done");
    const doc = view.document;
    expect(el.textContent).toContain("one");
    view.update(options("two"));
    await until(view, (s) => s.status === "done" && s.artifact?.target === "html" && s.artifact.html.includes("two"));
    expect(el.textContent).toContain("two");
    expect(view.document).toBe(doc);
    view.destroy();
    el.remove();
  });

  it("reopens the document when the preamble changes", async () => {
    const el = host();
    const view = mountTypstream(el, { engine, source: "#x", preamble: "#let x = [alpha]", lazy: false });
    await until(view, (s) => s.status === "done");
    const doc = view.document;
    view.update({ engine, source: "#x", preamble: "#let x = [beta]", lazy: false });
    expect(view.document).not.toBe(doc);
    await until(view, (s) => s.status === "done");
    expect(el.textContent).toContain("beta");
    view.destroy();
    el.remove();
  });

  it("shows what a failed stream delivered, finishes, and reports the error", async () => {
    const el = host();
    const reported: unknown[] = [];
    const report = globalThis.reportError;
    globalThis.reportError = (error) => reported.push(error);
    async function* failing() {
      yield "= Partial\n";
      yield "Some text";
      throw new Error("connection lost");
    }
    try {
      const view = mountTypstream(el, { engine, stream: failing(), lazy: false });
      const final = await until(view, settled);
      expect(final.final).toBe(true);
      expect(el.textContent).toContain("Some text");
      expect(reported).toHaveLength(1);
      view.destroy();
    } finally {
      globalThis.reportError = report;
      el.remove();
    }
  });
});
