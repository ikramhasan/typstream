// Protocol conformance (PLAN §11.3): what any server of `@typstream/core`'s
// protocol must do, independent of transport and engine. Written for
// @typstream/node's server; meant to move into a shared suite with #10's worker
// server, which should pass it unchanged.

import type {
  ArtifactNotification,
  CompileResult,
  DiagnosticsNotification,
  HtmlArtifact,
  PagedArtifact,
  ServerNotification,
} from "@typstream/core";
import { afterEach, describe, expect, it } from "vitest";
import { TestClient, type Transport } from "./client";

const PAGES = (n: number, tail = ""): string =>
  `#set page(width: 10cm, height: 6cm)\n${Array.from({ length: n }, (_, i) => `= Page ${i + 1}\nText ${i + 1}.`).join("\n#pagebreak()\n")}${tail}`;

const diagnosticsOf = (c: TestClient, rev: number): DiagnosticsNotification[] =>
  c
    .notifications()
    .filter((n): n is ServerNotification<"document/diagnostics"> => n.method === "document/diagnostics")
    .map((n) => n.params)
    .filter((p) => p.rev === rev);

const artifactsOf = (c: TestClient, rev: number): ArtifactNotification[] =>
  c
    .notifications()
    .filter((n): n is ServerNotification<"document/artifact"> => n.method === "document/artifact")
    .map((n) => n.params)
    .filter((p) => p.rev === rev);

const pagedOf = (c: TestClient, rev: number): PagedArtifact => {
  const a = artifactsOf(c, rev).at(-1)?.artifact;
  if (a?.target !== "paged") throw new Error(`no paged artifact for rev ${rev}`);
  return a;
};

export interface ConformanceOptions {
  /** Opens a fresh session (a new connection). */
  connect(): Promise<Transport>;
  /** A document the server must stop by its streaming watchdog. Skipped when absent. */
  runaway?: string;
}

export const describeConformance = (name: string, options: ConformanceOptions): void => {
  describe(`protocol conformance: ${name}`, () => {
    const clients: TestClient[] = [];
    const connect = async (): Promise<TestClient> => {
      const c = new TestClient(await options.connect());
      clients.push(c);
      return c;
    };
    const ready = async (pagedDiff = true): Promise<TestClient> => {
      const c = await connect();
      await c.initialize(pagedDiff);
      return c;
    };
    afterEach(() => {
      for (const c of clients.splice(0)) c.close();
    });

    describe("lifecycle", () => {
      it("answers initialize with capabilities and the Typst version", async () => {
        const c = await connect();
        const result = await c.initialize();
        expect(result.protocolVersion).toBe(1);
        expect(result.capabilities.targets).toEqual(expect.arrayContaining(["html", "paged"]));
        expect(result.serverInfo.typstVersion).toBe("0.15.1");
      });

      it("rejects a protocol version it doesn't speak, listing the ones it does", async () => {
        const c = await connect();
        const error = await c.request("initialize", { protocolVersion: 99, capabilities: {} }).catch((e) => e);
        expect(error.code).toBe("protocol-version-mismatch");
        expect(error.data).toEqual({ supported: [1] });
      });

      it("refuses requests before initialize and after shutdown", async () => {
        const c = await connect();
        expect(await c.errorOf("document/open", { uri: "a", rev: 1, text: "" })).toBe("not-initialized");
        await c.initialize();
        expect(await c.request("shutdown", null)).toBeNull();
        expect(await c.errorOf("document/open", { uri: "a", rev: 1, text: "" })).toBe("not-initialized");
      });

      it("answers unknown methods with method-not-found", async () => {
        const c = await ready();
        const { done } = c.start("nope" as "shutdown", null);
        expect(await done.catch((e) => e.code)).toBe("method-not-found");
      });
    });

    describe("documents", () => {
      it("tracks revisions: stale edits, compiles of old revisions, unknown and duplicate documents", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: "Hello" });
        expect(await c.errorOf("document/open", { uri: "a", rev: 1, text: "" })).toBe("document-already-open");
        expect(await c.errorOf("document/edit", { uri: "a", rev: 1, edits: [] })).toBe("stale-revision");
        await c.request("document/edit", { uri: "a", rev: 5, edits: [{ from: 5, to: 5, insert: "!" }] });
        expect(await c.errorOf("compile", { uri: "a", rev: 1, target: "html" })).toBe("content-modified");
        expect(await c.errorOf("compile", { uri: "b", rev: 1, target: "html" })).toBe("document-not-open");
        await c.request("document/close", { uri: "a", rev: 5 });
        expect(await c.errorOf("compile", { uri: "a", rev: 5, target: "html" })).toBe("document-not-open");
      });

      it("applies edits in order, each to the result of the previous one", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: "Hello world" });
        await c.request("document/edit", {
          uri: "a",
          rev: 2,
          edits: [
            { from: 0, to: 5, insert: "Goodbye" }, // "Goodbye world"
            { from: 8, to: 13, insert: "*moon*" }, // "Goodbye *moon*"
          ],
        });
        await c.request("compile", { uri: "a", rev: 2, target: "html" });
        const html = (artifactsOf(c, 2)[0]?.artifact as HtmlArtifact).html;
        expect(html).toContain("Goodbye <strong>moon</strong>");
      });

      it("rejects edits outside the text", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: "abc" });
        expect(await c.errorOf("document/edit", { uri: "a", rev: 2, edits: [{ from: 2, to: 9, insert: "" }] })).toBe(
          "invalid-params",
        );
      });

      it("reads files given at open and changed by setFiles", async () => {
        const c = await ready();
        const text = '#let d = json("data/v.json")\nValue: #d.v';
        await c.request("document/open", { uri: "a", rev: 1, text, files: { "data/v.json": '{"v": "first"}' } });
        await c.request("compile", { uri: "a", rev: 1, target: "html" });
        expect((artifactsOf(c, 1)[0]?.artifact as HtmlArtifact).html).toContain("Value: first");
        await c.request("document/setFiles", {
          uri: "a",
          rev: 2,
          files: { "data/v.json": new TextEncoder().encode('{"v": "second"}') },
        });
        await c.request("compile", { uri: "a", rev: 2, target: "html" });
        expect((artifactsOf(c, 2)[0]?.artifact as HtmlArtifact).html).toContain("Value: second");
        await c.request("document/setFiles", { uri: "a", rev: 3, files: { "data/v.json": null } });
        await c.request("compile", { uri: "a", rev: 3, target: "html" });
        expect(diagnosticsOf(c, 3)[0]?.diagnostics[0]?.message).toMatch(/not found/);
      });
    });

    describe("compile", () => {
      it("publishes diagnostics, then the artifact, then answers", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: "= Title\nSome *text*." });
        const { id, done } = c.start("compile", { uri: "a", rev: 1, target: "html" });
        const result = await done;
        expect(result).toMatchObject({ uri: "a", rev: 1, target: "html", status: "ok" });
        expect(result.timings.totalMs).toBeGreaterThan(0);
        const d = c.log.findIndex((m) => "method" in m && m.method === "document/diagnostics");
        const a = c.log.findIndex((m) => "method" in m && m.method === "document/artifact");
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(a);
        expect(a).toBeLessThan(c.responseIndex(id));
        expect((artifactsOf(c, 1)[0]?.artifact as HtmlArtifact).html).toContain("<strong>text</strong>");
      });

      it("reports a failed compile with diagnostics (UTF-16 spans) and no artifact", async () => {
        const c = await ready();
        const text = "Ünïcödé 😀 text #unknown-thing more";
        await c.request("document/open", { uri: "a", rev: 1, text });
        const result = await c.request("compile", { uri: "a", rev: 1, target: "paged" });
        expect(result.status).toBe("error");
        expect(artifactsOf(c, 1)).toEqual([]);
        const [d] = diagnosticsOf(c, 1)[0]?.diagnostics ?? [];
        expect(d?.message).toBe("unknown variable: unknown-thing");
        expect(d?.span && text.slice(d.span.from, d.span.to)).toBe("unknown-thing");
      });

      it("maps diagnostics around a preamble and attributes preamble errors to it", async () => {
        const c = await ready();
        const preamble = '#let shout(x) = upper(x)\n#let broken() = 1 + "a"';
        await c.request("document/open", { uri: "a", rev: 1, text: "#shout[hi] #nope", preamble });
        await c.request("compile", { uri: "a", rev: 1, target: "html" });
        const [d] = diagnosticsOf(c, 1)[0]?.diagnostics ?? [];
        expect(d?.span).toEqual({ from: 12, to: 16 });

        await c.request("document/edit", { uri: "a", rev: 2, edits: [{ from: 0, to: 16, insert: "x #broken()" }] });
        await c.request("compile", { uri: "a", rev: 2, target: "html" });
        const [e] = diagnosticsOf(c, 2)[0]?.diagnostics ?? [];
        expect(e?.message).toMatch(/cannot add integer and string/);
        expect(e?.file?.path).toBe("/preamble.typ");
        expect(e?.span).toEqual({ from: 3, to: 11 }); // the call site in the document
      });

      it("passes inputs as sys.inputs", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: "Hello #sys.inputs.name" });
        await c.request("compile", { uri: "a", rev: 1, target: "html", inputs: { name: "Ada" } });
        expect((artifactsOf(c, 1)[0]?.artifact as HtmlArtifact).html).toContain("Hello Ada");
      });

      it("rejects targets it doesn't offer", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: "" });
        expect(await c.errorOf("compile", { uri: "a", rev: 1, target: "pdf" as "html" })).toBe("unsupported");
      });
    });

    describe("paged", () => {
      it("sends every page first, then only changed pages with base = the previous paged revision", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: PAGES(3) });
        await c.request("compile", { uri: "a", rev: 1, target: "paged" });
        const first = pagedOf(c, 1);
        expect(first.base).toBeNull();
        expect(first.pageCount).toBe(3);
        expect(first.pages.map((p) => p.index)).toEqual([0, 1, 2]);
        for (const p of first.pages) {
          expect(p.svg.startsWith("<svg")).toBe(true);
          expect(p.width).toBeCloseTo(283.46, 1); // 10cm in pt
          expect(p.height).toBeCloseTo(170.08, 1);
        }
        expect(new Set(first.pages.map((p) => p.hash)).size).toBe(3);

        await c.request("document/edit", {
          uri: "a",
          rev: 2,
          edits: [{ from: PAGES(3).length, to: PAGES(3).length, insert: " More." }],
        });
        await c.request("compile", { uri: "a", rev: 2, target: "paged" });
        const second = pagedOf(c, 2);
        expect(second.base).toBe(1);
        expect(second.pageCount).toBe(3);
        expect(second.pages.map((p) => p.index)).toEqual([2]);
        expect(second.pages[0]?.hash).not.toBe(first.pages[2]?.hash);
      });

      it("reports a shrinking document through pageCount, and fullPages sends everything again", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: PAGES(3) });
        await c.request("compile", { uri: "a", rev: 1, target: "paged" });
        await c.request("document/edit", {
          uri: "a",
          rev: 2,
          edits: [{ from: 0, to: PAGES(3).length, insert: PAGES(2) }],
        });
        await c.request("compile", { uri: "a", rev: 2, target: "paged" });
        const shrunk = pagedOf(c, 2);
        expect(shrunk).toMatchObject({ base: 1, pageCount: 2, pages: [] });

        await c.request("compile", { uri: "a", rev: 2, target: "paged", fullPages: true });
        const full = pagedOf(c, 2);
        expect(full.base).toBeNull();
        expect(full.pages.map((p) => p.index)).toEqual([0, 1]);
      });

      it("keeps the baseline across a failed compile", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: PAGES(2) });
        await c.request("compile", { uri: "a", rev: 1, target: "paged" });
        await c.request("document/edit", { uri: "a", rev: 2, edits: [{ from: 0, to: 0, insert: "#nope " }] });
        expect((await c.request("compile", { uri: "a", rev: 2, target: "paged" })).status).toBe("error");
        await c.request("document/edit", { uri: "a", rev: 3, edits: [{ from: 0, to: 6, insert: "" }] });
        await c.request("compile", { uri: "a", rev: 3, target: "paged" });
        expect(pagedOf(c, 3)).toMatchObject({ base: 1, pageCount: 2, pages: [] });
      });

      it("diffs per document when several share the server", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: PAGES(2) });
        await c.request("document/open", { uri: "b", rev: 1, text: PAGES(2, " B") });
        await c.request("compile", { uri: "a", rev: 1, target: "paged" });
        await c.request("compile", { uri: "b", rev: 1, target: "paged" });
        await c.request("document/edit", { uri: "a", rev: 2, edits: [{ from: 0, to: 0, insert: "" }] });
        await c.request("compile", { uri: "a", rev: 2, target: "paged" });
        const a2 = artifactsOf(c, 2).find((n) => n.uri === "a")?.artifact as PagedArtifact;
        expect(a2).toMatchObject({ base: 1, pageCount: 2, pages: [] });
      });

      it("sends every page every time to a client without pagedDiff", async () => {
        const c = await ready(false);
        await c.request("document/open", { uri: "a", rev: 1, text: PAGES(2) });
        await c.request("compile", { uri: "a", rev: 1, target: "paged" });
        await c.request("document/edit", { uri: "a", rev: 2, edits: [{ from: 0, to: 0, insert: "" }] });
        await c.request("compile", { uri: "a", rev: 2, target: "paged" });
        expect(pagedOf(c, 2)).toMatchObject({ base: null, pageCount: 2 });
        expect(pagedOf(c, 2).pages).toHaveLength(2);
      });
    });

    describe("export", () => {
      it("exports PDF bytes and HTML of the current revision", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: PAGES(2) });
        const pdf = await c.request("export/pdf", { uri: "a", rev: 1 });
        expect(pdf.status).toBe("ok");
        if (pdf.status !== "ok") return;
        expect(pdf.data).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(pdf.data.slice(0, 5))).toBe("%PDF-");
        const html = await c.request("export/html", { uri: "a", rev: 1 });
        expect(html.status === "ok" && html.data).toContain("<h2>Page 1</h2>");
        expect(await c.errorOf("export/pdf", { uri: "a", rev: 0 })).toBe("content-modified");
      });

      it("reports a document that doesn't compile with diagnostics", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: "#nope" });
        const pdf = await c.request("export/pdf", { uri: "a", rev: 1 });
        expect(pdf).toMatchObject({ status: "error", diagnostics: [{ message: "unknown variable: nope" }] });
      });
    });

    describe("cancellation and robustness", () => {
      it("cancels a request that hasn't started", async () => {
        const c = await ready();
        await c.request("document/open", { uri: "a", rev: 1, text: PAGES(3) });
        const slow = c.start("compile", { uri: "a", rev: 1, target: "paged" });
        const queued = c.start("compile", { uri: "a", rev: 1, target: "html" });
        c.send({ method: "$/cancel", params: { id: queued.id } });
        await slow.done;
        expect(await queued.done.catch((e) => e.code)).toBe("request-cancelled");
        expect(artifactsOf(c, 1).map((a) => a.artifact.target)).toEqual(["paged"]);
      });

      it("answers malformed requests with invalid-params and keeps going", async () => {
        const c = await ready();
        expect(await c.errorOf("document/open", { uri: 3, rev: "x" } as never)).toBe("invalid-params");
        expect(await c.errorOf("document/open", { uri: "a", rev: 1, text: "", files: { "../x": "" } })).toBe(
          "invalid-params",
        );
        await c.request("document/open", { uri: "a", rev: 1, text: "ok" });
        expect((await c.request("compile", { uri: "a", rev: 1, target: "html" })).status).toBe("ok");
      });

      it("isolates sessions: documents are per connection", async () => {
        const a = await ready();
        const b = await ready();
        await a.request("document/open", { uri: "doc", rev: 1, text: "A" });
        expect(await b.errorOf("compile", { uri: "doc", rev: 1, target: "html" })).toBe("document-not-open");
        await b.request("document/open", { uri: "doc", rev: 1, text: "B" });
      });

      if (options.runaway) {
        const runaway = options.runaway;
        it("stops a runaway compile with its watchdog and keeps serving", async () => {
          const c = await ready();
          await c.request("document/open", { uri: "a", rev: 1, text: runaway });
          const result: CompileResult = await c.request("compile", { uri: "a", rev: 1, target: "html" });
          expect(result.status).toBe("error");
          expect(diagnosticsOf(c, 1)[0]?.diagnostics[0]).toMatchObject({ code: "timeout", source: "typstream" });
          await c.request("document/edit", {
            uri: "a",
            rev: 2,
            edits: [{ from: 0, to: runaway.length, insert: "fine" }],
          });
          expect((await c.request("compile", { uri: "a", rev: 2, target: "html" })).status).toBe("ok");
        });
      }
    });
  });
};
