// The engine server in Node: the conformance suite against engine-wasm on the
// calling thread, the main-thread client on top of it, and server behaviour
// that needs a scripted adapter (cancellation, crashes, failed startup).

import type { ClientMessage, Diagnostic, HtmlArtifact, ServerMessage } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import type { AdapterDocument, EngineAdapter } from "../src/server/adapter";
import { inProcess } from "../src/server/serve";
import { createServer, fromMain, PREAMBLE_PATH } from "../src/server/server";
import { codeOf, conformance, TestClient } from "./conformance";
import { nodeEngineWasm } from "./support/engine-wasm";

conformance("engine-wasm, in process", () => inProcess(nodeEngineWasm));

describe("client and server", () => {
  it("streams a document through heal, the scheduler and engine-wasm", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const doc = engine.open();
    const source = "= Fractions\n\nAdd $1/2 + 1/3$. *Show your work.*\n";
    for (const char of source) doc.push(char);
    doc.finish();
    const state = await new Promise<ReturnType<typeof doc.getState>>((resolve) => {
      doc.subscribe((s) => s.status === "done" && resolve(s));
    });
    expect(state.diagnostics).toEqual([]);
    expect((state.artifact as HtmlArtifact).html).toContain("Show your work.");
    engine.dispose();
  });
});

const span = (from: number, to: number) => ({ from, to });
const diag = (d: Partial<Diagnostic>): Diagnostic => ({
  severity: "error",
  span: null,
  message: "m",
  hints: [],
  trace: [],
  ...d,
});

describe("fromMain", () => {
  it("moves document spans past the preamble", () => {
    const d = diag({ span: span(12, 15), trace: [{ message: "t", span: span(10, 11) }] });
    expect(fromMain(d, 10)).toEqual(diag({ span: span(2, 5), trace: [{ message: "t", span: span(0, 1) }] }));
  });

  it("reports a problem in the preamble at its nearest call site in the document", () => {
    const d = diag({
      span: span(3, 6),
      trace: [
        { message: "in the preamble", span: span(1, 2) },
        { message: "called here", span: span(14, 20) },
      ],
    });
    expect(fromMain(d, 10)).toEqual(
      diag({
        span: span(4, 10),
        trace: [
          { message: "in the preamble", span: null },
          { message: "called here", span: span(4, 10) },
        ],
        file: { path: PREAMBLE_PATH, span: span(3, 6) },
      }),
    );
  });

  it("keeps the file of a problem in another file", () => {
    const file = { path: "/data.json", span: span(0, 1) };
    expect(fromMain(diag({ span: span(2, 4), file }), 10)).toEqual(diag({ span: null, file }));
  });
});

/** An adapter whose compiles are scripted by the source text. `modes` records each compile's mode. */
const scripted = (options: { init?: () => Promise<void>; modes?: unknown[] } = {}): EngineAdapter => ({
  info: { name: "scripted", typstVersion: "0.15.1" },
  targets: ["html"],
  exports: [],
  init: options.init ?? (async () => {}),
  open(): AdapterDocument {
    let main = "";
    return {
      setFiles(files) {
        for (const [path, content] of Object.entries(files)) {
          if (path.includes("..")) throw new Error(`invalid virtual path: ${path}`);
          if (path === "/main.typ") main = String(content);
        }
      },
      setInputs() {},
      compileHtml(o) {
        options.modes?.push(o?.mode);
        // A wasm trap is how a Typst panic surfaces.
        if (main.includes("PANIC")) throw new WebAssembly.RuntimeError("unreachable");
        if (main.includes("THROW")) throw new Error("adapter bug");
        return { html: `<p>${main}</p>`, diagnostics: [] };
      },
      compilePaged: () => ({ output: null, diagnostics: [] }),
      exportPdf(o) {
        options.modes?.push(o?.mode);
        return { pdf: new TextEncoder().encode(main), diagnostics: [] };
      },
      close() {},
    };
  },
});

/** A server on `adapter` driven directly, without a transport. */
const direct = (adapter: EngineAdapter) => {
  const out: ServerMessage[] = [];
  const fatal: unknown[] = [];
  const server = createServer(adapter, (m) => out.push(m), { onFatal: (e) => fatal.push(e) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  return { server, out, fatal, settle, send: (m: ClientMessage) => server.receive(m) };
};

describe("server", () => {
  it("drops requests cancelled before they start", async () => {
    let release = () => {};
    const s = direct(scripted({ init: () => new Promise((resolve) => (release = resolve)) }));
    s.send({ id: 1, method: "initialize", params: { protocolVersion: 1, capabilities: {} } });
    s.send({ id: 2, method: "document/open", params: { uri: "a", rev: 1, text: "x" } });
    s.send({ id: 3, method: "document/open", params: { uri: "b", rev: 1, text: "y" } });
    s.send({ method: "$/cancel", params: { id: 2 } });
    await s.settle();
    expect(s.out).toEqual([]);
    release();
    await s.settle();
    expect(s.out).toEqual([
      expect.objectContaining({ id: 1, result: expect.anything() }),
      { id: 2, error: { code: "request-cancelled", message: expect.any(String) } },
      { id: 3, result: null },
    ]);
  });

  it("answers `internal` when the adapter throws, and stops without answering on a trap", async () => {
    const s = direct(scripted());
    s.send({ id: 1, method: "initialize", params: { protocolVersion: 1, capabilities: {} } });
    s.send({ id: 2, method: "document/open", params: { uri: "a", rev: 1, text: "THROW" } });
    s.send({ id: 3, method: "compile", params: { uri: "a", rev: 1, target: "html" } });
    await s.settle();
    expect(s.out.at(-1)).toEqual({ id: 3, error: { code: "internal", message: "adapter bug" } });
    expect(s.fatal).toEqual([]);
    s.send({
      id: 4,
      method: "document/edit",
      params: { uri: "a", rev: 2, edits: [{ from: 0, to: 5, insert: "PANIC" }] },
    });
    s.send({ id: 5, method: "compile", params: { uri: "a", rev: 2, target: "html" } });
    await s.settle();
    expect(s.out.at(-1)).toEqual({ id: 4, result: null });
    expect(s.fatal).toHaveLength(1);
  });

  it("tells the adapter each compile's mode: the request's, streaming by default, final for exports", async () => {
    const modes: unknown[] = [];
    const s = direct({ ...scripted({ modes }), exports: ["html", "pdf"] });
    s.send({ id: 1, method: "initialize", params: { protocolVersion: 1, capabilities: {} } });
    s.send({ id: 2, method: "document/open", params: { uri: "a", rev: 1, text: "x" } });
    s.send({ id: 3, method: "compile", params: { uri: "a", rev: 1, target: "html" } });
    s.send({ id: 4, method: "compile", params: { uri: "a", rev: 1, target: "html", mode: "final" } });
    s.send({ id: 5, method: "export/html", params: { uri: "a", rev: 1 } });
    s.send({ id: 6, method: "export/pdf", params: { uri: "a", rev: 1 } });
    await s.settle();
    expect(modes).toEqual(["streaming", "final", "final", "final"]);
  });

  it("answers unknown methods with method-not-found", async () => {
    const s = direct(scripted());
    s.send({ id: 1, method: "initialize", params: { protocolVersion: 1, capabilities: {} } });
    s.send({ id: 2, method: "nope" as "shutdown", params: null });
    await s.settle();
    expect(s.out.at(-1)).toEqual({ id: 2, error: { code: "method-not-found", message: "unknown method nope" } });
  });

  it("refuses targets it lacks and file paths the adapter can't hold", async () => {
    const c = new TestClient(inProcess(() => scripted()));
    await c.initialize();
    await c.request("document/open", { uri: "a", rev: 1, text: "x" });
    expect(await codeOf(c.request("compile", { uri: "a", rev: 1, target: "paged" }))).toBe("unsupported");
    const outside = c.request("document/setFiles", { uri: "a", rev: 2, files: { "../up.png": new Uint8Array(1) } });
    expect(await codeOf(outside)).toBe("invalid-params");
    expect(await codeOf(c.request("resolve/span", { uri: "a", rev: 1, point: { page: 0, x: 0, y: 0 } }))).toBe(
      "unsupported",
    );
    c.close();
  });

  it("answers initialize with the adapter's failure, and can be initialized again", async () => {
    let attempts = 0;
    const c = new TestClient(
      inProcess(() =>
        scripted({
          init: async () => {
            if (++attempts === 1) throw new Error("wasm: HTTP 404");
          },
        }),
      ),
    );
    await expect(c.initialize()).rejects.toMatchObject({ code: "internal", message: "wasm: HTTP 404" });
    await expect(c.initialize()).resolves.toMatchObject({ serverInfo: { name: "scripted" } });
    expect(await codeOf(c.initialize())).toBe("invalid-params");
    c.close();
  });
});
