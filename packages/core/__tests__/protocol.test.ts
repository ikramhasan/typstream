import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type Artifact,
  type ClientMessage,
  type ClientNotification,
  type CompileParams,
  type CompileResult,
  type DocumentParams,
  type ErrorResponse,
  type ExportResult,
  isClientNotification,
  isErrorResponse,
  isRequest,
  isResponse,
  isServerNotification,
  type PagedArtifact,
  type ParamsOf,
  PROTOCOL_VERSION,
  ProtocolError,
  type Request,
  type RequestMethod,
  type Response,
  type ResultOf,
  type ServerMessage,
  type ServerNotification,
  type ServerNotificationMap,
  type ServerNotificationMethod,
  type TypstreamPlugin,
} from "../src";

// Methods that aren't about one document; everything else must carry `uri` + `rev`.
type ProtocolMethod = "initialize" | "shutdown";
type DocumentMethod = Exclude<RequestMethod, ProtocolMethod>;

// True if a function hides anywhere in T. Messages are structured-cloned, which
// throws on functions; the methods of arrays and Uint8Array are fine.
type HasFunction<T, Depth extends unknown[] = []> = Depth["length"] extends 12
  ? false // Recursive types (a page's `TextNode` tree) end here.
  : T extends (...args: never[]) => unknown
    ? true
    : T extends Uint8Array
      ? false
      : T extends readonly (infer E)[]
        ? HasFunction<E, [...Depth, 0]>
        : T extends object
          ? { [K in keyof T]-?: HasFunction<T[K], [...Depth, 0]> }[keyof T] extends false
            ? false
            : true
          : false;

describe("protocol types", () => {
  it("lists exactly the v1 methods", () => {
    expectTypeOf<RequestMethod>().toEqualTypeOf<
      | "initialize"
      | "shutdown"
      | "document/open"
      | "document/edit"
      | "document/setFiles"
      | "document/close"
      | "compile"
      | "export/pdf"
      | "export/html"
      | "export/docx"
      | "resolve/span"
      | "resolve/location"
    >();
    expectTypeOf<ServerNotificationMethod>().toEqualTypeOf<
      "document/diagnostics" | "document/artifact" | "fonts/loaded" | "$/log"
    >();
    expectTypeOf<ClientNotification["method"]>().toEqualTypeOf<"$/cancel">();
  });

  it("carries a revision on every document-scoped message", () => {
    expectTypeOf<ParamsOf<DocumentMethod>>().toExtend<DocumentParams>();
    expectTypeOf<Exclude<ResultOf<DocumentMethod>, null>>().toExtend<DocumentParams>();
    expectTypeOf<ServerNotificationMap["document/diagnostics" | "document/artifact"]>().toExtend<DocumentParams>();
    expectTypeOf<ExportResult<string>>().toExtend<DocumentParams>();
  });

  it("narrows requests and notifications by method", () => {
    expectTypeOf<Request<"compile">>().toEqualTypeOf<{ id: number; method: "compile"; params: CompileParams }>();
    const handle = (r: Request) => {
      if (r.method === "compile") expectTypeOf(r.params).toEqualTypeOf<CompileParams>();
      if (r.method === "shutdown") expectTypeOf(r.params).toBeNull();
    };
    const exhaustive = (n: ServerNotification): string => {
      switch (n.method) {
        case "document/diagnostics":
          return `${n.params.rev}:${n.params.diagnostics.length}`;
        case "document/artifact":
          return n.params.artifact.target;
        case "fonts/loaded":
          return n.params.family;
        case "$/log":
          return n.params.message;
        default:
          return n satisfies never;
      }
    };
    expectTypeOf(handle).toBeFunction();
    expectTypeOf(exhaustive).toBeFunction();
  });

  it("types responses by method", () => {
    expectTypeOf<Response<"compile">>().toEqualTypeOf<{ id: number; result: CompileResult } | ErrorResponse>();
    const onCompile = (r: Response<"compile">) => {
      if (isErrorResponse(r)) expectTypeOf(r.error.code).toBeString();
      else expectTypeOf(r.result.status).toEqualTypeOf<"ok" | "error">();
    };
    const onExport = (r: ResultOf<"export/pdf">) => {
      if (r.status === "ok") expectTypeOf(r.data).toEqualTypeOf<Uint8Array>();
      // @ts-expect-error: no data without a successful export
      else r.data;
    };
    expectTypeOf(onCompile).toBeFunction();
    expectTypeOf(onExport).toBeFunction();
  });

  it("discriminates artifacts by target", () => {
    const pages = (a: Artifact) => (a.target === "paged" ? a.pages : []);
    expectTypeOf(pages).returns.toEqualTypeOf<PagedArtifact["pages"]>();
  });

  it("rejects malformed messages", () => {
    // @ts-expect-error: compile needs a target
    const a: Request = { id: 1, method: "compile", params: { uri: "a", rev: 1 } };
    // @ts-expect-error: edits need a revision
    const b: Request = { id: 2, method: "document/edit", params: { uri: "a", edits: [] } };
    // @ts-expect-error: no such method
    const c: Request = { id: 3, method: "document/save", params: null };
    expect([a, b, c]).toHaveLength(3);
  });

  it("keeps messages and the engine facet structured-clonable", () => {
    expectTypeOf<HasFunction<ClientMessage>>().toEqualTypeOf<false>();
    expectTypeOf<HasFunction<ServerMessage>>().toEqualTypeOf<false>();
    expectTypeOf<HasFunction<NonNullable<TypstreamPlugin["engine"]>>>().toEqualTypeOf<false>();
    // The check itself works.
    expectTypeOf<HasFunction<{ a: { b: () => void } }>>().toEqualTypeOf<true>();
    expectTypeOf<HasFunction<{ a: (() => void)[] }>>().toEqualTypeOf<true>();
  });
});

describe("protocol helpers", () => {
  const request: ClientMessage = { id: 1, method: "document/close", params: { uri: "a", rev: 3 } };
  const cancel: ClientMessage = { method: "$/cancel", params: { id: 1 } };
  const ok: ServerMessage = { id: 1, result: null };
  const failed: ServerMessage = { id: 2, error: { code: "document-not-open", message: "no document a" } };
  const log: ServerMessage = { method: "$/log", params: { level: "info", message: "hi" } };

  it("tells messages apart", () => {
    expect([request, cancel].map(isRequest)).toEqual([true, false]);
    expect([request, cancel].map(isClientNotification)).toEqual([false, true]);
    expect([ok, failed, log].map(isResponse)).toEqual([true, true, false]);
    expect([ok, failed, log].map(isServerNotification)).toEqual([false, false, true]);
    expect([ok, failed].map((m) => isResponse(m) && isErrorResponse(m))).toEqual([false, true]);
  });

  it("survives structured cloning", () => {
    const paged: ServerMessage = {
      method: "document/artifact",
      params: {
        uri: "a",
        rev: 4,
        artifact: {
          target: "paged",
          base: 3,
          pageCount: 2,
          pages: [{ index: 1, hash: "ab", width: 595, height: 842, svg: "<svg/>" }],
        },
      },
    };
    const pdf: ServerMessage = {
      id: 5,
      result: { uri: "a", rev: 4, status: "ok", data: new Uint8Array([37, 80]), diagnostics: [] },
    };
    for (const m of [request, cancel, ok, failed, log, paged, pdf]) expect(structuredClone(m)).toEqual(m);
  });

  it("round-trips ProtocolError through the wire form", () => {
    const e = new ProtocolError("protocol-version-mismatch", "speaks 1", { supported: [1] });
    expect(e).toBeInstanceOf(Error);
    const wire = structuredClone(e.toJSON());
    expect(wire).toEqual({ code: "protocol-version-mismatch", message: "speaks 1", data: { supported: [1] } });
    const back = ProtocolError.from(wire);
    expect([back.name, back.code, back.message, back.data]).toEqual(["ProtocolError", e.code, e.message, e.data]);
    expect(new ProtocolError("internal", "x").toJSON()).toEqual({ code: "internal", message: "x" });
  });

  it("starts at version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
