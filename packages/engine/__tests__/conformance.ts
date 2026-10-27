// The protocol conformance suite (PLAN §11.3): what any engine server must do,
// whatever compiles behind it. It talks the raw protocol through a SpawnEngine,
// so it runs against the in-process server in Node (server.test.ts), the real
// worker in each browser (browser/integration.test.ts), and later the server
// adapter of @typstream/node (#22):
//
//   import { conformance } from "../../engine/__tests__/conformance";
//   conformance("my adapter", () => mySpawn);
//
// Expectations are about protocol behaviour and Typst 0.15.1's output, never
// about one adapter's internals.

import {
  type Artifact,
  type CompileParams,
  type CompileResult,
  type Diagnostic,
  type DocumentUri,
  type InitializeResult,
  type PagedArtifact,
  type ParamsOf,
  PROTOCOL_VERSION,
  ProtocolError,
  type RequestMethod,
  type ResultOf,
  type ServerNotification,
} from "@typstream/core";
import { afterEach, describe, expect, it } from "vitest";
import { Connection, type SpawnEngine } from "../src/connection";

/** Diagnostics and artifacts in the order they arrived, then the response. */
interface Compiled {
  result: CompileResult;
  /** Notification methods in arrival order, response last. */
  order: string[];
  diagnostics: Diagnostic[];
  artifact: Artifact | null;
}

/** A bare protocol client: requests, and the notifications each one produced. */
export class TestClient {
  private readonly conn: Connection;
  private notes: ServerNotification[] = [];
  readonly errors: unknown[] = [];

  constructor(spawn: SpawnEngine) {
    this.conn = new Connection(
      spawn,
      (n) => this.notes.push(n),
      (e) => this.errors.push(e),
    );
  }

  request<M extends RequestMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    return this.conn.request(method, params).result;
  }

  /** Sends a request and returns its id without waiting. */
  start<M extends RequestMethod>(method: M, params: ParamsOf<M>): { id: number; result: Promise<ResultOf<M>> } {
    return this.conn.request(method, params);
  }

  cancel(id: number): void {
    this.conn.notify("$/cancel", { id });
  }

  initialize(): Promise<InitializeResult> {
    return this.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: { pagedDiff: true } });
  }

  async compile(params: CompileParams): Promise<Compiled> {
    this.notes = [];
    const result = await this.request("compile", params);
    const mine = this.notes.filter((n) => "uri" in n.params && n.params.uri === params.uri);
    const diagnostics = mine.flatMap((n) => (n.method === "document/diagnostics" ? [n.params.diagnostics] : []));
    const artifacts = mine.flatMap((n) => (n.method === "document/artifact" ? [n.params.artifact] : []));
    return {
      result,
      order: [...mine.map((n) => n.method), "response"],
      diagnostics: diagnostics.at(-1) ?? [],
      artifact: artifacts.at(-1) ?? null,
    };
  }

  close(): void {
    this.conn.close("dispose");
  }
}

/** The rejection's protocol error code. */
export const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ProtocolError) return e.code;
    throw e;
  }
  throw new Error("expected the request to fail");
};

const html = (c: Compiled): string => {
  expect(c.artifact?.target).toBe("html");
  return c.artifact?.target === "html" ? c.artifact.html : "";
};

const paged = (c: Compiled): PagedArtifact => {
  expect(c.artifact?.target).toBe("paged");
  return c.artifact as PagedArtifact;
};

const errors = (ds: Diagnostic[]) => ds.filter((d) => d.severity === "error");

/** A three-page document; the last page's text is `last`. */
const threePages = (last: string) => `#set page(paper: "a4")\nOne\n#pagebreak()\nTwo\n#pagebreak()\n${last}\n`;

/**
 * Registers the suite. `spawn` must start a fresh server each call. `timeout`
 * is per test (the first compile in a cold browser can take a few seconds).
 */
export const conformance = (name: string, spawn: () => SpawnEngine, timeout = 30_000): void => {
  describe(`protocol conformance: ${name}`, { timeout }, () => {
    const clients: TestClient[] = [];
    afterEach(() => {
      for (const c of clients.splice(0)) c.close();
    });

    const client = (): TestClient => {
      const c = new TestClient(spawn());
      clients.push(c);
      return c;
    };

    const ready = async (): Promise<TestClient> => {
      const c = client();
      await c.initialize();
      return c;
    };

    let next = 0;
    const open = async (c: TestClient, text: string, extra: Partial<ParamsOf<"document/open">> = {}) => {
      const uri: DocumentUri = `doc-${++next}`;
      await c.request("document/open", { uri, rev: 1, text, ...extra });
      return uri;
    };

    describe("initialize", () => {
      it("answers with the protocol version, Typst version and capabilities", async () => {
        const info = await client().initialize();
        expect(info.protocolVersion).toBe(PROTOCOL_VERSION);
        expect(info.serverInfo.typstVersion).toBe("0.15.1");
        expect(info.capabilities.targets).toEqual(expect.arrayContaining(["html", "paged"]));
        expect(info.capabilities.pagedDiff).toBe(true);
      });

      it("rejects a protocol version it doesn't speak, saying which it does", async () => {
        const c = client();
        const failed = c.request("initialize", { protocolVersion: PROTOCOL_VERSION + 1, capabilities: {} });
        await expect(failed).rejects.toMatchObject({
          code: "protocol-version-mismatch",
          data: { supported: [PROTOCOL_VERSION] },
        });
      });

      it("refuses requests before initialize and after shutdown", async () => {
        const c = client();
        expect(await codeOf(c.request("document/open", { uri: "a", rev: 1, text: "" }))).toBe("not-initialized");
        await c.initialize();
        expect(await c.request("shutdown", null)).toBeNull();
        expect(await codeOf(c.request("document/open", { uri: "a", rev: 1, text: "" }))).toBe("not-initialized");
      });
    });

    describe("compile (html)", () => {
      it("publishes diagnostics, then the artifact, then answers", async () => {
        const c = await ready();
        const uri = await open(c, "= Hello\nWorld, $x^2$.");
        const out = await c.compile({ uri, rev: 1, target: "html" });
        expect(out.order).toEqual(["document/diagnostics", "document/artifact", "response"]);
        expect(out.result).toMatchObject({ uri, rev: 1, target: "html", status: "ok" });
        expect(out.result.timings.totalMs).toBeGreaterThanOrEqual(0);
        expect(html(out)).toContain("Hello");
        expect(html(out)).toContain("<math");
        expect(errors(out.diagnostics)).toEqual([]);
      });

      it("publishes only diagnostics for a document with errors", async () => {
        const c = await ready();
        const uri = await open(c, "Hi #nope");
        const out = await c.compile({ uri, rev: 1, target: "html" });
        expect(out.order).toEqual(["document/diagnostics", "response"]);
        expect(out.result.status).toBe("error");
        expect(errors(out.diagnostics)).toEqual([
          expect.objectContaining({ message: "unknown variable: nope", span: { from: 4, to: 8 }, hints: [] }),
        ]);
      });

      it("reports spans in UTF-16 code units", async () => {
        const c = await ready();
        // ü is one UTF-16 unit (two UTF-8 bytes), 😀 two (four bytes).
        const uri = await open(c, "ü😀 #nope");
        const out = await c.compile({ uri, rev: 1, target: "html" });
        expect(errors(out.diagnostics)[0]?.span).toEqual({ from: 5, to: 9 });
      });

      it("passes sys.inputs", async () => {
        const c = await ready();
        const uri = await open(c, `Name: #sys.inputs.at("name", default: "none")`);
        expect(html(await c.compile({ uri, rev: 1, target: "html", inputs: { name: "Ada" } }))).toContain("Ada");
        expect(html(await c.compile({ uri, rev: 1, target: "html" }))).toContain("none");
      });
    });

    describe("documents", () => {
      it("applies edits in order, each to the previous result", async () => {
        const c = await ready();
        const uri = await open(c, "Hello");
        await c.request("document/edit", {
          uri,
          rev: 2,
          edits: [
            { from: 5, to: 5, insert: " wide world" },
            { from: 6, to: 10, insert: "brave" },
          ],
        });
        expect(html(await c.compile({ uri, rev: 2, target: "html" }))).toContain("Hello brave world");
      });

      it("rejects stale revisions, compiles of old revisions and edits outside the text", async () => {
        const c = await ready();
        const uri = await open(c, "Hello");
        await c.request("document/edit", { uri, rev: 3, edits: [{ from: 0, to: 0, insert: "> " }] });
        expect(await codeOf(c.request("document/edit", { uri, rev: 3, edits: [] }))).toBe("stale-revision");
        expect(await codeOf(c.request("compile", { uri, rev: 1, target: "html" }))).toBe("content-modified");
        const outside = c.request("document/edit", { uri, rev: 4, edits: [{ from: 3, to: 99, insert: "" }] });
        expect(await codeOf(outside)).toBe("invalid-params");
        // A rejected edit changes nothing.
        expect(html(await c.compile({ uri, rev: 3, target: "html" }))).toContain("<p>> Hello</p>");
      });

      it("keeps documents apart, and knows which are open", async () => {
        const c = await ready();
        const a = await open(c, "Alpha");
        const b = await open(c, "Beta");
        expect(await codeOf(c.request("document/open", { uri: a, rev: 1, text: "" }))).toBe("document-already-open");
        expect(html(await c.compile({ uri: a, rev: 1, target: "html" }))).toContain("Alpha");
        expect(html(await c.compile({ uri: b, rev: 1, target: "html" }))).toContain("Beta");
        await c.request("document/close", { uri: a, rev: 1 });
        expect(await codeOf(c.request("compile", { uri: a, rev: 1, target: "html" }))).toBe("document-not-open");
        expect(html(await c.compile({ uri: b, rev: 1, target: "html" }))).toContain("Beta");
      });

      it("evaluates the preamble first, outside the document's coordinates", async () => {
        const c = await ready();
        const uri = await open(c, "#greet #nope", { preamble: '#let greet = "Hi there"' });
        const out = await c.compile({ uri, rev: 1, target: "html" });
        expect(errors(out.diagnostics)).toEqual([expect.objectContaining({ span: { from: 8, to: 12 } })]);
        await c.request("document/edit", { uri, rev: 2, edits: [{ from: 6, to: 12, insert: "" }] });
        expect(html(await c.compile({ uri, rev: 2, target: "html" }))).toContain("Hi there");
      });

      it("reports problems in the preamble with its location in `file`", async () => {
        const c = await ready();
        const uri = await open(c, "Fine.", { preamble: "#broken" });
        const [d] = errors((await c.compile({ uri, rev: 1, target: "html" })).diagnostics);
        expect(d).toMatchObject({ span: null, file: { span: { from: 1, to: 7 } } });
      });

      it("reads the document's files", async () => {
        const c = await ready();
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
        const uri = await open(c, '#json("data/q.json").title #image("pic.svg")', {
          files: { "data/q.json": '{ "title": "Quiz 3" }', "pic.svg": new TextEncoder().encode(svg) },
        });
        expect(html(await c.compile({ uri, rev: 1, target: "html" }))).toContain("Quiz 3");
        await c.request("document/setFiles", { uri, rev: 2, files: { "data/q.json": '{ "title": "Quiz 4" }' } });
        expect(html(await c.compile({ uri, rev: 2, target: "html" }))).toContain("Quiz 4");
        // (A deleted image would show as a placeholder: the engine's missing-image fixer.)
        await c.request("document/setFiles", { uri, rev: 3, files: { "data/q.json": null } });
        const gone = await c.compile({ uri, rev: 3, target: "html" });
        expect(gone.result.status).toBe("error");
        expect(errors(gone.diagnostics)[0]?.message).toMatch(/not found/);
        // The document itself isn't a file the client can overwrite.
        const main = c.request("document/setFiles", { uri, rev: 4, files: { "main.typ": "x" } });
        expect(await codeOf(main)).toBe("invalid-params");
      });
    });

    describe("compile (paged)", () => {
      it("sends every page first, then only the pages that changed", async () => {
        const c = await ready();
        const uri = await open(c, threePages("Three"));
        const first = paged(await c.compile({ uri, rev: 1, target: "paged" }));
        expect(first.base).toBeNull();
        expect(first.pageCount).toBe(3);
        expect(first.pages.map((p) => p.index)).toEqual([0, 1, 2]);
        for (const page of first.pages) {
          expect(page.width).toBeCloseTo(595.28, 1);
          expect(page.height).toBeCloseTo(841.89, 1);
          expect(page.hash).toMatch(/^[0-9a-f]+$/);
          expect(page.svg).toMatch(/^<svg/);
        }
        await c.request("document/edit", {
          uri,
          rev: 2,
          edits: [{ from: 0, to: threePages("Three").length, insert: threePages("3") }],
        });
        const second = paged(await c.compile({ uri, rev: 2, target: "paged" }));
        expect(second.base).toBe(1);
        expect(second.pageCount).toBe(3);
        expect(second.pages.map((p) => p.index)).toEqual([2]);
        expect(second.pages[0]?.hash).not.toBe(first.pages[2]?.hash);
      });

      it("drops removed pages and sends all of them on request", async () => {
        const c = await ready();
        const uri = await open(c, threePages("Three"));
        await c.compile({ uri, rev: 1, target: "paged" });
        const two = `#set page(paper: "a4")\nOne\n#pagebreak()\nTwo\n`;
        await c.request("document/edit", {
          uri,
          rev: 2,
          edits: [{ from: 0, to: threePages("Three").length, insert: two }],
        });
        const shrunk = paged(await c.compile({ uri, rev: 2, target: "paged" }));
        expect(shrunk).toMatchObject({ base: 1, pageCount: 2, pages: [] });
        const all = paged(await c.compile({ uri, rev: 2, target: "paged", fullPages: true }));
        expect(all.base).toBeNull();
        expect(all.pages.map((p) => p.index)).toEqual([0, 1]);
      });

      it("diffs against the last paged artifact, not a failed compile or an HTML one", async () => {
        const c = await ready();
        const uri = await open(c, threePages("Three"));
        const text = threePages("Three");
        await c.compile({ uri, rev: 1, target: "paged" });
        await c.request("document/edit", {
          uri,
          rev: 2,
          edits: [{ from: text.length, to: text.length, insert: "#nope" }],
        });
        expect((await c.compile({ uri, rev: 2, target: "paged" })).result.status).toBe("error");
        await c.request("document/edit", {
          uri,
          rev: 3,
          edits: [{ from: text.length, to: text.length + 5, insert: "" }],
        });
        expect(paged(await c.compile({ uri, rev: 3, target: "paged" }))).toMatchObject({ base: 1, pages: [] });
        // After HTML, the client holds no pages to diff against.
        await c.compile({ uri, rev: 3, target: "html" });
        const after = paged(await c.compile({ uri, rev: 3, target: "paged" }));
        expect(after.base).toBeNull();
        expect(after.pages).toHaveLength(3);
      });
    });

    describe("export", () => {
      it("exports HTML, and refuses formats it doesn't offer", async () => {
        const c = client();
        const info = await c.initialize();
        const uri = await open(c, "= Title");
        const out = await c.request("export/html", { uri, rev: 1 });
        expect(out).toMatchObject({ uri, rev: 1, status: "ok" });
        expect(out.status === "ok" && out.data).toContain("Title");
        if (!info.capabilities.exports.includes("pdf")) {
          expect(await codeOf(c.request("export/pdf", { uri, rev: 1 }))).toBe("unsupported");
        }
      });

      it("exports PDF when it offers it, with errors as diagnostics", async () => {
        const c = client();
        const info = await c.initialize();
        if (!info.capabilities.exports.includes("pdf")) return;
        const uri = await open(c, "= Title\n#pagebreak()\nTwo");
        const out = await c.request("export/pdf", { uri, rev: 1 });
        expect(out).toMatchObject({ uri, rev: 1, status: "ok", diagnostics: [] });
        const pdf = out.status === "ok" ? out.data : new Uint8Array();
        expect(String.fromCharCode(...pdf.subarray(0, 5))).toBe("%PDF-");
        await c.request("document/edit", { uri, rev: 2, edits: [{ from: 0, to: 0, insert: "#nope\n" }] });
        const failed = await c.request("export/pdf", { uri, rev: 2 });
        expect(failed).toMatchObject({ uri, rev: 2, status: "error" });
        expect(failed.diagnostics.map((d) => [d.message, d.span])).toEqual([
          ["unknown variable: nope", { from: 1, to: 5 }],
        ]);
      });
    });
  });
};
