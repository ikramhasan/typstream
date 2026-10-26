// Layer 3 fixers (PLAN §5.5) against the diagnostics engine-wasm really
// reports: the fixers alone, the fix loop through the protocol server, and
// snapshots of the diagnostic shapes they rely on, so a Typst upgrade that
// changes a message or a span shows up here first.

import type { CompileParams, Diagnostic, DiagnosticFixer, FixContext, HtmlArtifact, TextEdit } from "@typstream/core";
import { PROTOCOL_VERSION } from "@typstream/core";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineAdapter } from "../src/server/adapter";
import { DEFAULT_FIXERS, fixersOf, orderFixers, pendingRef, tailCut } from "../src/server/fixers";
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

  it("only streams", () => {
    expect(tailCut.modes).toEqual(["streaming"]);
  });
});

describe("registry", () => {
  const f = (name: string, priority?: number): DiagnosticFixer => ({ name, priority, fix: () => null });

  it("orders by priority, then as given; built-ins bracket plugin fixers", () => {
    const order = orderFixers([...DEFAULT_FIXERS, f("a"), f("b", 5), f("c")]).map((x) => x.name);
    expect(order).toEqual(["b", "pending-ref", "a", "c", "tail-cut"]);
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

const serverWith = async (options: ServerOptions & { fixerModules?: string[] } = {}) => {
  const { counter, adapter } = counted();
  const c = new TestClient(inProcess(adapter, options));
  clients.push(c);
  await c.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { pagedDiff: true },
    options: { fixerModules: options.fixerModules },
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
  });

  it("cuts nothing the client didn't say is unsettled", async () => {
    const { compile } = await serverWith();
    const out = await compile("Intro.\n\n#text()");
    expect(out.result.status).toBe("error");
    expect(out.compiles).toBe(1);
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
  });

  it("keeps a final document's missing labels as errors next to the placeholder", async () => {
    const { compile } = await serverWith();
    const text = "See @fig-a.";
    const out = await compile(text, { mode: "final" });
    expect(out.result.status).toBe("ok");
    expect(out.diagnostics.map((d) => [d.severity, d.source, at(text, d)])).toEqual([["error", "typst", "@fig-a"]]);
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
    expect([three.result.status, three.compiles]).toEqual(["error", 3]);
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
