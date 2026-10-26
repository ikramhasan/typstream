// Lazy fonts (#11, PLAN §6.4): a compile that lacks a font the adapter is
// fetching renders with fallbacks, and the server recompiles the document on
// its own once the font has arrived. Exports wait for it.

import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ClientMessage, PagedArtifact, ServerMessage } from "@typstream/core";
import { scriptFonts } from "@typstream/engine-wasm/fonts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import type { AdapterDocument, AdapterHtmlResult, EngineAdapter } from "../src/server/adapter";
import { inProcess } from "../src/server/serve";
import { createServer } from "../src/server/server";
import { nodeEngineWasm } from "./support/engine-wasm";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(e: Error): void;
}

const deferred = (): Deferred => {
  let resolve = () => {};
  let reject = (_: Error) => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/**
 * An adapter whose compiles lack a font while `font` is unresolved: their
 * HTML says so and they return it as `pending`.
 */
const fontless = () => {
  let font: Deferred | null = deferred();
  const compiles: string[] = [];
  const result = (main: string): AdapterHtmlResult => {
    const missing = font !== null;
    compiles.push(main);
    const r: AdapterHtmlResult = { html: `<p>${main}${missing ? " (tofu)" : ""}</p>`, diagnostics: [] };
    if (font) r.pending = font.promise;
    return r;
  };
  const adapter: EngineAdapter = {
    info: { name: "fontless", typstVersion: "0.15.1" },
    targets: ["html"],
    exports: ["pdf"],
    init: async () => {},
    open(): AdapterDocument {
      let main = "";
      return {
        setFiles(files) {
          if (typeof files["/main.typ"] === "string") main = files["/main.typ"];
        },
        setInputs() {},
        compileHtml: () => result(main),
        compilePaged: () => ({ output: null, diagnostics: [] }),
        exportPdf() {
          const { html, ...rest } = result(main);
          return { ...rest, pdf: new TextEncoder().encode(html ?? "") };
        },
        close() {},
      };
    },
  };
  const arrive = async (ok = true) => {
    const f = font;
    font = null;
    if (ok) f?.resolve();
    else f?.reject(new Error("font X: HTTP 404"));
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { adapter, compiles, arrive };
};

const start = (adapter: EngineAdapter) => {
  const out: ServerMessage[] = [];
  const server = createServer(adapter, (m) => out.push(m));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const send = (m: ClientMessage) => server.receive(m);
  send({ id: 0, method: "initialize", params: { protocolVersion: 1, capabilities: {} } });
  return { out, settle, send };
};

const artifacts = (out: ServerMessage[]) =>
  out.flatMap((m) => ("method" in m && m.method === "document/artifact" ? [m.params] : []));

describe("server, when a compile lacks a font", () => {
  it("recompiles the document once it arrives, publishing output for the same revision", async () => {
    const { adapter, compiles, arrive } = fontless();
    const s = start(adapter);
    s.send({ id: 1, method: "document/open", params: { uri: "a", rev: 1, text: "আমি" } });
    s.send({ id: 2, method: "compile", params: { uri: "a", rev: 1, target: "html", anchors: false } });
    await s.settle();
    expect(artifacts(s.out)).toEqual([{ uri: "a", rev: 1, artifact: { target: "html", html: "<p>আমি (tofu)</p>" } }]);
    s.out.length = 0;
    await arrive();
    await s.settle();
    expect(compiles).toEqual(["আমি", "আমি"]);
    // Diagnostics, then the artifact, and no response: nothing asked.
    expect(s.out.map((m) => ("method" in m ? m.method : "response"))).toEqual([
      "document/diagnostics",
      "document/artifact",
    ]);
    expect(artifacts(s.out)).toEqual([{ uri: "a", rev: 1, artifact: { target: "html", html: "<p>আমি</p>" } }]);
  });

  it("leaves documents that changed or closed since to their next compile", async () => {
    const { adapter, compiles, arrive } = fontless();
    const s = start(adapter);
    s.send({ id: 1, method: "document/open", params: { uri: "a", rev: 1, text: "a" } });
    s.send({ id: 2, method: "document/open", params: { uri: "b", rev: 1, text: "b" } });
    s.send({ id: 3, method: "compile", params: { uri: "a", rev: 1, target: "html", anchors: false } });
    s.send({ id: 4, method: "compile", params: { uri: "b", rev: 1, target: "html", anchors: false } });
    s.send({ id: 5, method: "document/edit", params: { uri: "a", rev: 2, edits: [{ from: 1, to: 1, insert: "!" }] } });
    s.send({ id: 6, method: "document/close", params: { uri: "b", rev: 1 } });
    await s.settle();
    await arrive();
    await s.settle();
    expect(compiles).toEqual(["a", "b"]);
  });

  it("logs a font that can't arrive and keeps the output it has", async () => {
    const { adapter, compiles, arrive } = fontless();
    const s = start(adapter);
    s.send({ id: 1, method: "document/open", params: { uri: "a", rev: 1, text: "a" } });
    s.send({ id: 2, method: "compile", params: { uri: "a", rev: 1, target: "html", anchors: false } });
    await s.settle();
    s.out.length = 0;
    await arrive(false);
    expect(compiles).toEqual(["a"]);
    expect(s.out).toEqual([{ method: "$/log", params: { level: "warn", message: expect.stringMatching(/HTTP 404/) } }]);
  });

  it("makes exports wait for it", async () => {
    const { adapter, compiles, arrive } = fontless();
    const s = start(adapter);
    s.send({ id: 1, method: "document/open", params: { uri: "a", rev: 1, text: "a" } });
    s.send({ id: 2, method: "export/pdf", params: { uri: "a", rev: 1 } });
    await s.settle();
    expect(s.out.some((m) => "id" in m && m.id === 2)).toBe(false);
    await arrive();
    const answer = s.out.find((m) => "id" in m && m.id === 2);
    expect(answer).toMatchObject({ result: { status: "ok", data: new TextEncoder().encode("<p>a</p>") } });
    expect(compiles).toEqual(["a", "a"]);
  });
});

describe("engine-wasm with lazy fonts", () => {
  let http: Server;
  const requests: string[] = [];
  let lazyFonts: { url: string; info: string }[];

  beforeAll(async () => {
    http = createHttpServer((req, res) => {
      const file = scriptFonts.find((f) => req.url === `/${f.file}`);
      requests.push(req.url ?? "");
      if (!file) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": "font/ttf" }).end(readFileSync(file.url));
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const { port } = http.address() as AddressInfo;
    lazyFonts = scriptFonts.map((f) => ({ url: `http://127.0.0.1:${port}/${f.file}`, info: f.info }));
  });

  afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

  const BENGALI = "#set page(width: 10cm, height: auto)\n= প্রশ্ন ১\nআমি বাংলায় গান গাই।\n";

  it("downloads only the fonts a document uses, and renders with them once they arrive", async () => {
    const engine = createEngine({ spawn: inProcess(() => nodeEngineWasm(lazyFonts)), spare: false });
    const render = async (source: string) => {
      const doc = engine.open({ target: "paged" });
      const svgs: string[] = [];
      doc.subscribe((s) => {
        const page = (s.artifact as PagedArtifact | null)?.pages[0]?.svg;
        if (page && page !== svgs.at(-1)) svgs.push(page);
      });
      doc.set(source);
      doc.finish();
      await new Promise<void>((resolve) => doc.subscribe((s) => s.status === "done" && resolve()));
      return { doc, svgs };
    };

    await render("= Question 1\nEnglish only, and Ελληνικά, and русский.");
    expect(requests).toEqual([]);

    const lazy = await render(BENGALI);
    // The first render falls back to tofu; the server's recompile replaces it.
    await expect.poll(() => lazy.svgs.length).toBe(2);
    expect(requests.sort()).toEqual(["/NotoSerifBengali-Bold.ttf", "/NotoSerifBengali-Regular.ttf"]);

    // A document opened now has the fonts from the start: the same page.
    const fresh = await render(BENGALI);
    expect(fresh.svgs).toEqual([lazy.svgs[1]]);
    expect(lazy.svgs[0]).not.toEqual(lazy.svgs[1]);
    engine.dispose();
  });
});
