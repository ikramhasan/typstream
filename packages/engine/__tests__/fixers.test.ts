// Layer 3 fixers (PLAN §5.5) against the diagnostics engine-wasm really
// reports: the fixers alone, the fix loop through the protocol server, and
// snapshots of the diagnostic shapes they rely on, so a Typst upgrade that
// changes a message or a span shows up here first.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  CompileParams,
  Diagnostic,
  DiagnosticFixer,
  FixContext,
  HtmlArtifact,
  PackageSpec,
  PagedArtifact,
  TextEdit,
} from "@typstream/core";
import { PROTOCOL_VERSION } from "@typstream/core";
import { loadCorpus } from "@typstream/corpus";
import { heal } from "@typstream/heal";
import { UNIVERSE_PACKAGES } from "@typstream/universe";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineAdapter } from "../src/server/adapter";
import { DEFAULT_FIXERS, fixersOf, orderFixers, packageStub, pendingRef, tailCut } from "../src/server/fixers";
import { RUNTIME_PATH, typstString } from "../src/server/runtime";
import { inProcess } from "../src/server/serve";
import type { ServerOptions } from "../src/server/server";
import { codeOf, TestClient } from "./conformance";
import { nodeEngineWasm } from "./support/engine-wasm";

const ctx = (text: string, settled = 0, errors: Diagnostic[] = []): FixContext => ({
  text,
  settled,
  mode: "streaming",
  round: 0,
  errors,
});

/** The built-in fixers answer synchronously. */
const run = (fixer: DiagnosticFixer, d: Diagnostic, c: FixContext) => fixer.fix(d, c) as TextEdit[] | null;

const error = (message: string, from: number, to: number, trace: Diagnostic["trace"] = []): Diagnostic => ({
  severity: "error",
  span: { from, to },
  message,
  hints: [],
  trace,
  source: "typst",
});

const missing = (key: string, text: string, ref = `@${key}`) => {
  const from = text.indexOf(ref);
  return error(`label \`<${key}>\` does not exist in the document`, from, from + ref.length);
};

describe("pending-ref", () => {
  it("turns a reference in markup into a placeholder, supplement and all", () => {
    const text = "See @ipcc2021[p. 4], then more.";
    const d = missing("ipcc2021", text, "@ipcc2021[p. 4]");
    expect(run(pendingRef, d, ctx(text))).toEqual([{ from: 4, to: 19, insert: '#typstream.pending-ref("ipcc2021");' }]);
  });

  it("rewrites ref(<key>) in code without a hash", () => {
    const text = "#ref(<fig-a>)";
    expect(run(pendingRef, missing("fig-a", text, "ref(<fig-a>)"), ctx(text))).toEqual([
      { from: 1, to: 13, insert: 'typstream.pending-ref("fig-a")' },
    ]);
  });

  it("leaves references it can't see in the text alone", () => {
    // A function body building references from strings: the span is inside it.
    const text = '#let r(k) = ref(label(k))\n#r("a")';
    const d = error("label `<a>` does not exist in the document", 12, 25);
    expect(run(pendingRef, d, ctx(text))).toBeNull();
    expect(run(pendingRef, { ...d, span: null }, ctx(text))).toBeNull();
  });

  it("writes keys as Typst strings", () => {
    expect(typstString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("package-stub", () => {
  const SPEC = "@preview/x:1.0.0";
  const stub = (text: string, message = `package ${SPEC} is not allowed`) => {
    const from = text.indexOf(`"${SPEC}"`);
    const edits = run(packageStub, error(message, from, from + SPEC.length + 2), ctx(text));
    return edits && edits.length === 1
      ? text.slice(0, edits[0]?.from) + edits[0]?.insert + text.slice(edits[0]?.to)
      : null;
  };
  const call = `typstream.missing-package("${SPEC}")`;

  it("binds imported names to placeholders", () => {
    expect(stub(`#import "${SPEC}": a, b.c as d, e\nText`)).toBe(`#let (a, d, e) = (${call},) * 3\nText`);
    expect(stub(`#import "${SPEC}": (\n  a,\n  b,\n)\n`)).toBe(`#let (a, b) = (${call},) * 2\n`);
    expect(stub(`#import "${SPEC}": f\n`)).toBe(`#let f = ${call}\n`);
  });

  it("binds the module's name for a bare or renamed import", () => {
    expect(stub(`#import "${SPEC}"\n`)).toBe(`#let x = ${call}\n`);
    expect(stub(`#import "${SPEC}" as m: f\n`)).toBe(`#let (m, f) = (${call},) * 2\n`);
    expect(stub(`#{ import "${SPEC}" as m }`)).toBe(`#{ let m = ${call} }`);
  });

  it("stubs packages still loading, failed, or unknown to Typst", () => {
    for (const message of [
      `package ${SPEC} is still loading`,
      `package ${SPEC} failed to load (HTTP 404)`,
      `package not found (searched for ${SPEC})`,
    ]) {
      expect(stub(`#import "${SPEC}": f\n`, message)).toBe(`#let f = ${call}\n`);
    }
  });

  it("leaves wildcard imports and specs outside an import alone", () => {
    expect(stub(`#import "${SPEC}": *\n`)).toBeNull();
    expect(stub(`#include "${SPEC}"\n`)).toBeNull();
  });
});

describe("tail-cut", () => {
  it("cuts at an error in the tail and heals what is left", () => {
    const text = "Intro.\n\n#text()";
    expect(run(tailCut, error("missing argument: body", 9, 15), ctx(text, 8))).toEqual([
      { from: 8, to: 15, insert: "" },
    ]);
  });

  it("closes what the cut leaves open", () => {
    const text = "#table(columns: 2, [a], [*b #v(1)*])";
    const [edit] = run(tailCut, error("expected relative length or fraction, found integer", 31, 32), ctx(text)) ?? [];
    expect(edit && text.slice(0, edit.from) + edit.insert + text.slice(edit.to)).toBe(
      "#table(columns: 2, [a], [*b *])",
    );
  });

  it("cuts at the call site in the tail when the error is in a settled function", () => {
    const text = "#let f(x) = x.enumerate()\n#f([Arg])";
    const d = error("element text has no method `enumerate`", 12, 23, [
      { message: "while calling `f`", span: { from: 27, to: 35 } },
    ]);
    expect(run(tailCut, d, ctx(text, 26))).toEqual([{ from: 26, to: 35, insert: "" }]);
  });

  it("never touches settled text", () => {
    const text = "#nope and more";
    expect(run(tailCut, error("unknown variable: nope", 1, 5), ctx(text, 6))).toBeNull();
    expect(run(tailCut, { ...error("unknown font family: x", 0, 0), span: null }, ctx(text))).toBeNull();
  });

  it("cuts a call or group the cut leaves empty, and the call's name", () => {
    const cases: [string, string, string][] = [
      // text, the error's span text, the result
      ['Colour: #rgb("#e")', '"#e"', "Colour: "],
      ['#rect(width: 1cm, fill: rgb("#e"))', '"#e"', "#rect(width: 1cm, )"],
      ["#curve(curve.line(()))", "()", ""],
      // A method on a value keeps the value, across lines too.
      ["#table(..xs.zip(ys)\n  .map(((k, s))))", "k", "#table(..xs.zip(ys))"],
      ["#{ (1, 2).map(x) }", "x", "#{ (1, 2)}"],
    ];
    for (const [text, at, result] of cases) {
      const from = text.indexOf(at);
      const [edit] = run(tailCut, error("e", from, from + at.length), ctx(text)) ?? [];
      expect(edit && text.slice(0, edit.from) + edit.insert + text.slice(edit.to)).toBe(result);
    }
  });

  it("stops cascading at settled text", () => {
    const text = 'Colour: #rgb("#e")';
    const [edit] = run(tailCut, error("e", 13, 17), ctx(text, 13)) ?? [];
    expect(edit && text.slice(0, edit.from) + edit.insert + text.slice(edit.to)).toBe("Colour: #rgb()");
  });

  it("cuts what is open at the end of the text for an error with no position in it", () => {
    // A package evaluating the document's content (CeTZ, #72): no span, no trace in the text.
    const unlocated = { ...error("panicked with: Failed to resolve coordinate system: 6", 0, 0), span: null };
    const cases: [string, string | null][] = [
      // text (healed), the result: the value being typed, then the call holding it
      ["#canvas({\n  line((0, 0), (6))})", "#canvas({\n  line((0, 0), )})"],
      ["#canvas({\n  line((0, 0), )})", "#canvas({\n  })"],
      // A string left empty leaves the call empty: both go.
      ['Density in #unit("")', "Density in "],
      ["#canvas({\n  content((0, 1), [Unit circ])})", "#canvas({\n  content((0, 1), )})"],
      // Closers can't tell healing's from the stream's: a complete call counts as still being typed
      // (CeTZ's anchor `"b"` defined later in the stream).
      ['#canvas({\n  line("a", "b")\n})', '#canvas({\n  line("a", )})'],
      // Nothing open: nothing to cut.
      ["Plain text.", null],
    ];
    for (const [text, result] of cases) {
      const [edit] = run(tailCut, unlocated, ctx(text)) ?? [];
      expect(edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : null, text).toBe(result);
    }
    // Settled text stays, and an error placed in settled text isn't cut at the end.
    expect(run(tailCut, unlocated, ctx("#canvas({\n  line((0, 0), (6))})", 26))).toBeNull();
    const settledError = error("e", 2, 3);
    expect(run(tailCut, settledError, ctx("#canvas({\n  line((0, 0), (6))})", 10))).toBeNull();
  });

  it("only streams", () => {
    expect(tailCut.modes).toEqual(["streaming"]);
  });
});

describe("registry", () => {
  const f = (name: string, priority?: number): DiagnosticFixer => ({ name, priority, fix: () => null });

  it("orders by priority, then as given; built-ins bracket plugin fixers", () => {
    const order = orderFixers([...DEFAULT_FIXERS, f("a"), f("b", 5), f("c")]).map((x) => x.name);
    expect(order).toEqual(["b", "pending-ref", "package-stub", "a", "c", "tail-cut"]);
  });

  it("checks a fixer module's default export", () => {
    expect(fixersOf(f("one"), "u")).toHaveLength(1);
    expect(fixersOf([f("one"), f("two")], "u")).toHaveLength(2);
    expect(() => fixersOf({ name: "x" }, "u")).toThrow(/default export/);
    expect(() => fixersOf(undefined, "u")).toThrow(/default export/);
  });
});

// ---------------------------------------------------------------------------
// The fix loop, through the protocol server and engine-wasm.

/** engine-wasm, counting compiles. */
const counted = () => {
  const counter = { compiles: 0 };
  const adapter = (): EngineAdapter => {
    const inner = nodeEngineWasm();
    return {
      ...inner,
      init: (o) => inner.init(o),
      open() {
        const doc = inner.open();
        return {
          ...doc,
          compileHtml(o) {
            counter.compiles++;
            return doc.compileHtml(o);
          },
          compilePaged(o) {
            counter.compiles++;
            return doc.compilePaged(o);
          },
        };
      },
    };
  };
  return { counter, adapter };
};

const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

/** `allow`: the Typst packages `initialize` allows. */
const serverWith = async (options: ServerOptions & { fixerModules?: string[]; allow?: PackageSpec[] } = {}) => {
  const { counter, adapter } = counted();
  const c = new TestClient(inProcess(adapter, options));
  clients.push(c);
  await c.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { pagedDiff: true },
    options: { fixerModules: options.fixerModules, packages: options.allow },
  });
  let n = 0;
  const compile = async (text: string, params: Partial<CompileParams> = {}, preamble?: string) => {
    const uri = `d${n++}`;
    await c.request("document/open", { uri, rev: 1, text, preamble });
    counter.compiles = 0;
    const out = await c.compile({ uri, rev: 1, target: "html", anchors: false, ...params });
    return { ...out, compiles: counter.compiles, html: (out.artifact as HtmlArtifact | null)?.html ?? "" };
  };
  return { client: c, compile };
};

const at = (text: string, d: Diagnostic) => (d.span ? text.slice(d.span.from, d.span.to) : null);

describe("fix loop", { timeout: 30_000 }, () => {
  it("cuts a call whose arguments haven't arrived, and reports the cut as info", async () => {
    const { compile } = await serverWith();
    const text = "Intro.\n\n#text()";
    const out = await compile(text, { settled: 8 });
    expect(out.result.status).toBe("ok");
    expect(out.html).toContain("Intro.");
    expect(out.compiles).toBe(2);
    expect(out.result.timings.fixMs).toBeGreaterThan(0);
    expect(out.diagnostics).toEqual([
      expect.objectContaining({ severity: "info", source: "tail-cut", message: "missing argument: body" }),
    ]);
    expect(at(text, out.diagnostics[0] as Diagnostic)).toBe("text()");
    expect(out.result.fixes).toEqual([{ fixer: "tail-cut", message: "missing argument: body" }]);
  });

  it("cuts nothing the client didn't say is unsettled", async () => {
    const { compile } = await serverWith();
    const out = await compile("Intro.\n\n#text()");
    expect(out.result.status).toBe("error");
    expect(out.compiles).toBe(1);
    expect(out.result.fixes).toBeUndefined();
    expect(out.diagnostics).toEqual([expect.objectContaining({ severity: "error", source: "typst" })]);
  });

  it("doesn't cut in final mode", async () => {
    const { compile } = await serverWith();
    const out = await compile("Intro.\n\n#text()", { mode: "final", settled: 8 });
    expect(out.result.status).toBe("error");
  });

  it("shows a citation before its bibliography as a placeholder", async () => {
    const { compile } = await serverWith();
    const text = "Warming is measured @ipcc2021 and @nasa.\n";
    const out = await compile(text, { settled: text.length });
    expect(out.result.status).toBe("ok");
    expect(out.compiles).toBe(2);
    expect(out.html).toContain('<span class="typstream-pending-ref" style="opacity: 0.55">ipcc2021</span>');
    expect(out.html).toContain(">nasa</span>");
    expect(out.diagnostics.map((d) => [d.severity, d.source, at(text, d)])).toEqual([
      ["info", "pending-ref", "@ipcc2021"],
      ["info", "pending-ref", "@nasa"],
    ]);
    expect(out.result.fixes).toEqual([
      { fixer: "pending-ref", message: "label `<ipcc2021>` does not exist in the document" },
      { fixer: "pending-ref", message: "label `<nasa>` does not exist in the document" },
    ]);
  });

  it("keeps a final document's missing labels as errors next to the placeholder", async () => {
    const { compile } = await serverWith();
    const text = "See @fig-a.";
    const out = await compile(text, { mode: "final" });
    expect(out.result.status).toBe("ok");
    expect(out.diagnostics.map((d) => [d.severity, d.source, at(text, d)])).toEqual([["error", "typst", "@fig-a"]]);
    expect(out.result.fixes?.map((f) => f.fixer)).toEqual(["pending-ref"]);
  });

  it("draws the placeholder in paged output too", async () => {
    const { client, compile } = await serverWith();
    const out = await compile("See @key.", { target: "paged" });
    expect(out.result.status).toBe("ok");
    expect(out.artifact?.target === "paged" && out.artifact.pageCount).toBe(1);
    expect(client.errors).toEqual([]);
  });

  it("cuts a call left without arguments in the same round", async () => {
    const { compile } = await serverWith();
    const out = await compile('Colour: #rgb("#e")', { settled: 0 });
    expect(out.result.status).toBe("ok");
    expect(out.compiles).toBe(2);
    expect(out.html).toContain("Colour:");
  });

  it("takes a second round when the first cut leaves a call without its body", async () => {
    const { compile } = await serverWith();
    const out = await compile("#box[#place(center, dx: 3)]", { settled: 0 });
    expect(out.result.status).toBe("ok");
    expect(out.compiles).toBe(3);
    expect(out.diagnostics.map((d) => d.message)).toEqual([
      "expected relative length, found integer",
      "missing argument: body",
    ]);
    // In the order fixed: one per round.
    expect(out.result.fixes?.map((f) => f.message)).toEqual([
      "expected relative length, found integer",
      "missing argument: body",
    ]);
  });

  it("gives up after two rounds and reports the first compile's errors", async () => {
    // Renames `n3` to `n2`, and so on: one step per round; only `n0` exists.
    const countdown: DiagnosticFixer = {
      name: "countdown",
      match: /^unknown variable: n[1-9]$/,
      fix: (d) =>
        d.span ? [{ from: d.span.from + 1, to: d.span.to, insert: String(Number(d.message.at(-1)) - 1) }] : null,
    };
    const { compile } = await serverWith({ fixers: [countdown] });
    const two = await compile("#let n0 = [zero]\n#n2", { mode: "final" });
    expect([two.result.status, two.compiles, two.html.includes("zero")]).toEqual(["ok", 3, true]);
    const three = await compile("#let n0 = [zero]\n#n3", { mode: "final" });
    expect(two.result.fixes?.map((f) => [f.fixer, f.message])).toEqual([
      ["countdown", "unknown variable: n2"],
      ["countdown", "unknown variable: n1"],
    ]);
    expect([three.result.status, three.compiles, three.result.fixes]).toEqual(["error", 3, undefined]);
    expect(three.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", message: "unknown variable: n3" }),
    ]);
  });

  it("doesn't recompile when an error has no fixer", async () => {
    const { compile } = await serverWith();
    const out = await compile("#nope and @key", { settled: 5 });
    expect(out.result.status).toBe("error");
    expect(out.compiles).toBe(1);
  });

  it("maps positions back past the preamble, the runtime import and earlier fixes", async () => {
    const { compile } = await serverWith();
    const text = "See @a and @b.\n\n#text()";
    const out = await compile(text, { settled: 16 }, "#set text(size: 12pt)");
    expect(out.result.status).toBe("ok");
    // Evaluation stops at `text()`, so the references fail only in the second round.
    expect(out.compiles).toBe(3);
    expect(out.diagnostics.map((d) => [d.source, at(text, d)])).toEqual([
      ["tail-cut", "text()"],
      ["pending-ref", "@a"],
      ["pending-ref", "@b"],
    ]);
  });

  it("anchors a fixed text at the client's offsets", async () => {
    const { compile } = await serverWith();
    const text = "= One\n\nSee @a.\n\n= Two\n\nEnd.\n";
    const plain = await compile(text.replace("@a", "aa"), { anchors: true });
    const fixed = await compile(text, { anchors: true });
    const anchors = (html: string) => [...html.matchAll(/data-src="(\d+)"/g)].map((m) => m[1]);
    expect(fixed.result.status).toBe("ok");
    expect(anchors(fixed.html)).toEqual(anchors(plain.html));
    expect(anchors(fixed.html)).toEqual(["0", "7", "16", "23"]);
  });

  it("is off with no fixers", async () => {
    const { compile } = await serverWith({ fixers: [] });
    const out = await compile("See @a.", { settled: 0 });
    expect(out.result.status).toBe("error");
    expect(out.compiles).toBe(1);
  });

  describe("a package's error with no position in the document (#72)", () => {
    // CeTZ evaluates a canvas's elements in its own code: a half-typed coordinate panics with
    // no span and no trace in the document. The stream, as #24 recorded it.
    const entry = loadCorpus({ sets: ["llm"] }).find((e) => e.name === "kit-v4-haiku-worksheet-area-perimeter");
    const source = entry?.source ?? "";
    const canvas = source.indexOf("#cetz.canvas", source.indexOf("The triangle below"));
    /** The triangle's canvas up to `end`, healed as the client heals it. */
    const prefix = (end: string) =>
      heal(`#import "@preview/cetz:0.5.3"\n\n${source.slice(canvas, source.indexOf(end, canvas) + end.length)}`);
    // The vendored tarballs, read from disk (Node's fetch can't read file: URLs).
    const fetch = async (url: string) => new Response(readFileSync(fileURLToPath(url)));
    /**
     * Runs `f` with `performance.now()` stopped, so no budget runs out however slow the machine: these tests are about
     * what the fixers cut, not how fast. The streaming fix budget (`FIX_BUDGET_MS`, 1 s) counts from the request,
     * package loading included, and a slow CI machine spent all of it on CeTZ: no fix round started. (The server is
     * in-process: it reads this clock.)
     */
    const unhurried = async <T>(f: () => Promise<T>): Promise<T> => {
      const now = vi.spyOn(performance, "now").mockReturnValue(performance.now());
      try {
        return await f();
      } finally {
        now.mockRestore();
      }
    };
    /** A server with CeTZ loaded and evaluated once: on a stopped clock, loading packages waits for them to arrive. */
    const cetz = async () => {
      const server = await serverWith({ packages: { fetch, cache: false }, allow: [...UNIVERSE_PACKAGES] });
      const empty = prefix("import cetz.draw: *");
      const out = await unhurried(() => server.compile(empty.source, { settled: empty.stableOffset, target: "paged" }));
      expect(out.result.status).toBe("ok");
      return server;
    };

    /** Paths the canvas draws: the page's, less those of the canvas with no elements yet. */
    const drawn = async (compile: Awaited<ReturnType<typeof cetz>>["compile"], out: { artifact: unknown }) => {
      const empty = prefix("import cetz.draw: *");
      const paths = (a: unknown) => (a as PagedArtifact).pages[0]?.svg?.match(/<path /g)?.length ?? 0;
      const base = await compile(empty.source, { settled: empty.stableOffset, target: "paged" });
      return paths(out.artifact) - paths(base.artifact);
    };

    it("cuts the value being typed, then the call holding it", async () => {
      const { compile } = await cetz();
      const healed = prefix("line((0, 0), (6");
      const tail = healed.source.slice(healed.stableOffset);
      // The whole canvas is unsettled: Layer 4's stable prefix would drop it.
      expect(tail.startsWith("#cetz.canvas(") && tail.endsWith("line((0, 0), (6))})")).toBe(true);
      const out = await unhurried(() => compile(healed.source, { settled: healed.stableOffset, target: "paged" }));
      expect([out.result.status, out.compiles]).toEqual(["ok", 3]);
      // The panic has nothing in the document to point at; the line left with one point does.
      expect(out.diagnostics.map((d) => [d.severity, d.source, d.message, at(healed.source, d)])).toEqual([
        ["info", "tail-cut", "panicked with: Failed to resolve coordinate system: 6", null],
        ["info", "tail-cut", "assertion failed: Line must have a minimum of two points", "line((0, 0), (6))"],
      ]);
      expect(await drawn(compile, out)).toBe(0);
    });

    it("keeps the arguments that arrived", async () => {
      const { compile } = await cetz();
      const healed = prefix("line((0, 0), (6, 0), (3, ");
      const out = await unhurried(() => compile(healed.source, { settled: healed.stableOffset, target: "paged" }));
      expect([out.result.status, out.compiles]).toEqual(["ok", 2]);
      expect(out.result.fixes).toEqual([
        { fixer: "tail-cut", message: "panicked with: Failed to resolve coordinate system: (3,)" },
      ]);
      // The base of the triangle is drawn.
      expect(await drawn(compile, out)).toBe(1);
    });
  });

  it("lets a document's own runtime file restyle placeholders", async () => {
    const { client } = await serverWith();
    await client.request("document/open", {
      uri: "own",
      rev: 1,
      text: "See @a.",
      files: { [RUNTIME_PATH.slice(1)]: "#let pending-ref(key) = [(#key pending)]" },
    });
    const out = await client.compile({ uri: "own", rev: 1, target: "html", anchors: false });
    expect((out.artifact as HtmlArtifact).html).toContain("(a pending)");
  });
});

describe("fixer modules", { timeout: 30_000 }, () => {
  const moduleUrl = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

  it("loads plugin fixers by URL and runs them before the catch-all", async () => {
    const url = moduleUrl(`export default {
      name: "acme/no-nope",
      match: /^unknown variable: nope$/,
      fix: (d) => [{ from: d.span.from - 1, to: d.span.to, insert: "nope" }],
    };`);
    const { compile } = await serverWith({ fixerModules: [url] });
    const text = "Say #nope.";
    const out = await compile(text, { settled: 0 });
    expect(out.result.status).toBe("ok");
    expect(out.html).toContain("Say nope.");
    expect(out.diagnostics).toEqual([expect.objectContaining({ source: "acme/no-nope", severity: "info" })]);
  });

  it("skips a fixer that throws", async () => {
    const url = moduleUrl(`export default [{ name: "broken", fix: () => { throw new Error("bug"); } }];`);
    const { compile } = await serverWith({ fixerModules: [url] });
    const out = await compile("Intro.\n\n#text()", { settled: 8 });
    expect(out.result.status).toBe("ok");
    expect(out.diagnostics[0]?.source).toBe("tail-cut");
  });

  it("fails initialize on a module that doesn't load or export fixers", async () => {
    for (const url of [moduleUrl("export default 42;"), moduleUrl("syntax error(")]) {
      const c = new TestClient(inProcess(nodeEngineWasm));
      clients.push(c);
      const init = c.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        options: { fixerModules: [url] },
      });
      expect(await codeOf(init)).toBe("invalid-params");
    }
  });
});

// ---------------------------------------------------------------------------
// The diagnostics the fixers read, as Typst 0.15.1 reports them for healed
// stream prefixes. A Typst upgrade that changes one fails here: check the
// fixers' patterns (pending-ref's message, tail-cut's spans and traces).

describe("diagnostic shapes", { timeout: 30_000 }, () => {
  const PREFIXES = [
    // pending-ref
    "Cited @ipcc2021.",
    "A partial @fig-",
    "#ref(<nope>)",
    // tail-cut: calls closed before their arguments, values being typed, closures, traces
    "Hello\n\n#text()",
    "#align(center)",
    "#v(1)",
    "#rect(stroke: ())",
    '#rgb("#e")',
    '#text(lang: "")[x]',
    "#range(3).map(((i, (w, ))))",
    "#let f(x) = x.enumerate()\n#f([Arg])",
    '#bibliography("assets/clim")',
  ];

  it("matches the snapshot", async () => {
    const { compile } = await serverWith({ fixers: [] });
    const shapes: unknown[] = [];
    for (const text of PREFIXES) {
      const { diagnostics } = await compile(text);
      shapes.push({
        text,
        diagnostics: diagnostics.map((d) => ({
          severity: d.severity,
          message: d.message,
          at: at(text, d),
          trace: d.trace.map((t) => [t.message, t.span && text.slice(t.span.from, t.span.to)]),
        })),
      });
    }
    expect(shapes).toMatchSnapshot();
  });
});
