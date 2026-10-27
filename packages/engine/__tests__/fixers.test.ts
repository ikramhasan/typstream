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
import {
  DEFAULT_FIXERS,
  fixersOf,
  hoistImport,
  missingImage,
  orderFixers,
  packageStub,
  pendingRef,
  tailCut,
} from "../src/server/fixers";
import { RUNTIME_PATH, typstString } from "../src/server/runtime";
import { inProcess } from "../src/server/serve";
import type { ServerOptions } from "../src/server/server";
import { codeOf, TestClient } from "./conformance";
import { nodeEngineWasm } from "./support/engine-wasm";

const ctx = (text: string, settled = 0, errors: Diagnostic[] = []): FixContext => ({
  text,
  settled,
  settledFrom: text.length,
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

describe("hoist-import", () => {
  /** The text after hoistImport's edits for an `unknown variable: name` at `use`, or `null`. */
  const hoist = (text: string, use: string, c: Partial<FixContext> = {}) => {
    const from = text.indexOf(use);
    const name = /^[\p{L}_][\p{L}\p{N}_-]*/u.exec(use)?.[0] as string;
    const d = error(`unknown variable: ${name}`, from, from + name.length);
    const edits = run(hoistImport, d, { ...ctx(text, text.length), ...c });
    if (!edits) return null;
    let out = text;
    for (const e of [...edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    return out;
  };
  const CETZ = '#import "@preview/cetz:0.5.3"';

  it("moves a package import below a helper that uses it to the start", () => {
    const text = `= Alkanes\n\n#let chain(n) = cetz.canvas({})\n\n${CETZ}\n\n#chain(2)\n`;
    expect(hoist(text, "cetz.canvas")).toBe(`${CETZ}\n= Alkanes\n\n#let chain(n) = cetz.canvas({})\n\n\n#chain(2)\n`);
  });

  it("moves an import of items or an alias, above a template that uses them", () => {
    const unify = '#import "@preview/unify:0.8.1": num, qty, unit';
    const text = `#show: exam.with(instructions: [Use #unit("m/s^2").])\n${unify}\n`;
    expect(hoist(text, "unit(")).toBe(`${unify}\n#show: exam.with(instructions: [Use #unit("m/s^2").])\n`);
    expect(hoist(`#f()\n#import "@preview/x:1.0.0" as m: f\n`, "f()")).toBe(
      `#import "@preview/x:1.0.0" as m: f\n#f()\n`,
    );
    expect(hoist(`#m.f()\n#import "@preview/x:1.0.0" as m\n`, "m.f")).toBe(`#import "@preview/x:1.0.0" as m\n#m.f()\n`);
    expect(hoist(`#d()\n#import "@preview/x:1.0.0": (a, b.c as d)\n`, "d()")).toBe(
      `#import "@preview/x:1.0.0": (a, b.c as d)\n#d()\n`,
    );
  });

  it("keeps the line ending and leaves a last line without one whole", () => {
    expect(hoist(`#cetz.canvas({})\r\n${CETZ}\r\nEnd`, "cetz")).toBe(`${CETZ}\n#cetz.canvas({})\r\nEnd`);
    expect(hoist(`#cetz.canvas({})\n${CETZ}`, "cetz")).toBe(`${CETZ}\n#cetz.canvas({})\n`);
  });

  it("leaves wildcards, other names, earlier imports and file imports alone", () => {
    expect(hoist(`#dv(f)\n#import "@preview/physica:0.9.8": *\n`, "dv")).toBeNull();
    expect(hoist(`#canvas()\n${CETZ}\n`, "canvas")).toBeNull();
    expect(hoist(`${CETZ}\n#let f() = cetz.canvas({})\n`, "cetz")).toBeNull();
    expect(hoist(`#util.f()\n#import "util.typ"\n`, "util")).toBeNull();
  });

  it("leaves imports in raw text, comments, blocks and indented lines alone", () => {
    expect(hoist(`#cetz.canvas({})\n\`\`\`typ\n${CETZ}\n\`\`\`\n`, "cetz")).toBeNull();
    expect(hoist(`#cetz.canvas({})\n/*\n${CETZ}\n*/\n`, "cetz")).toBeNull();
    expect(hoist(`#cetz.canvas({})\n#box[\n${CETZ}\n]\n`, "cetz")).toBeNull();
    expect(hoist(`#cetz.canvas({})\n  ${CETZ}\n`, "cetz")).toBeNull();
  });

  it("moves only a settled import while streaming", () => {
    const text = `#cetz.canvas({})\n${CETZ}\n`;
    expect(hoist(text, "cetz", { settled: text.indexOf(CETZ) + 5 })).toBeNull();
    expect(hoist(text, "cetz", { settled: text.length })).toBe(`${CETZ}\n#cetz.canvas({})\n`);
    expect(hoist(text, "cetz", { mode: "final", settled: 0 })).toBe(`${CETZ}\n#cetz.canvas({})\n`);
  });
});

describe("missing-image", () => {
  /** `text` with `fixer`'s edit for an error `message` at `span` (the first match of it in `text`) applied. */
  const fixed = (text: string, message: string, span: string) => {
    const from = text.indexOf(span);
    const edits = run(missingImage, error(message, from, from + span.length), ctx(text));
    return edits && edits.length === 1
      ? text.slice(0, edits[0]?.from) + edits[0]?.insert + text.slice(edits[0]?.to)
      : null;
  };
  const notFound = "file not found (searched at /cat.png)";

  it("stands a placeholder in for an image's source, keeping its other arguments", () => {
    expect(fixed('#image("cat.png", width: 50%)', notFound, '"cat.png"')).toBe(
      '#image(typstream.missing-image("cat.png"), width: 50%)',
    );
    expect(fixed('#figure(image(\n  source: "cat.png"), caption: [A cat])', notFound, '"cat.png"')).toBe(
      '#figure(image(\n  source: typstream.missing-image("cat.png")), caption: [A cat])',
    );
    // A name holding the path: the placeholder can't show it, but it stands in all the same.
    expect(fixed("#let src = 1\n#image(src)", notFound, "src)")).toBe(
      "#let src = 1\n#image(typstream.missing-image(src))",
    );
  });

  it("leaves files that aren't an image's source alone", () => {
    expect(fixed('#read("cat.png")', notFound, '"cat.png"')).toBeNull();
    expect(fixed('#json("q.json")', notFound, '"q.json"')).toBeNull();
  });

  it("reads a file its extension misnames as bytes, then gives up on it", () => {
    const decode = "failed to decode image (Format error decoding Png: Invalid PNG signature.)";
    const text = '#image("a.png", width: 2cm)';
    const once = fixed(text, decode, 'image("a.png", width: 2cm)');
    expect(once).toBe('#image(read("a.png", encoding: none), width: 2cm)');
    expect(fixed(once as string, "unknown image format", 'image(read("a.png", encoding: none), width: 2cm)')).toBe(
      '#image(typstream.missing-image("a.png"), width: 2cm)',
    );
    expect(fixed('#image("a.bin")', "unknown image format", 'image("a.bin")')).toBe(
      '#image(typstream.missing-image("a.bin"))',
    );
    // Bytes built some other way: nothing to stand in for.
    expect(fixed('#image(bytes("x"))', "unknown image format", 'image(bytes("x"))')).toBeNull();
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
    expect(order).toEqual(["b", "pending-ref", "missing-image", "package-stub", "hoist-import", "a", "c", "tail-cut"]);
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

/** The vendored Typst Universe tarballs, read from disk (Node's fetch can't read file: URLs). */
const fetchVendored = async (url: string) => new Response(readFileSync(fileURLToPath(url)));

/**
 * Runs `f` with `performance.now()` stopped, so no budget runs out however slow the machine: these tests are about
 * what the fixers do, not how fast. The fix budgets (`FIX_BUDGET_MS`) count from the request, package loading
 * included, and a slow CI machine spent all of the streaming one on CeTZ: no fix round started. (The server is
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

  it("cuts only inside a streaming range, keeping the settled text after it", async () => {
    const { compile } = await serverWith();
    const text = 'Intro.\n\nColour: #rgb("#e")\n\nAfter the edit.';
    const settledFrom = text.indexOf("\n\nAfter");
    const out = await compile(text, { settled: "Intro.\n\n".length, settledFrom });
    expect(out.result.status).toBe("ok");
    expect(out.html).toContain("Colour:");
    expect(out.html).toContain("After the edit.");
    // Without it, the cut takes everything after the error with it.
    expect((await compile(text, { settled: "Intro.\n\n".length })).html).not.toContain("After the edit.");
    // An error after the range is settled text's: nothing to cut.
    const after = 'Intro.\n\nWriting.\n\nColour: #rgb("#e")';
    const kept = await compile(after, { settled: "Intro.\n\n".length, settledFrom: after.indexOf("\n\nColour") });
    expect(kept.result.status).not.toBe("ok");
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

  describe("a package import below a name it binds", () => {
    // How the model wrote it (a "Molecules" request in examples/nextjs-ai-sdk): a helper on CeTZ, then the import.
    const ALKANES = `= The first five alkanes

#let chain(n) = cetz.canvas({
  import cetz.draw: *
  let pts = range(n).map(i => (i * 0.87, if calc.rem(i, 2) == 0 { 0 } else { 0.5 }))
  line(..pts, stroke: 1.4pt)
})

#import "@preview/cetz:0.5.3"

#table(columns: 2, [Ethane], [#chain(2)], [Propane], [#chain(3)])
`;
    // As kit-v1-sonnet-exam-forces (corpus/llm) has it: unify in the template's arguments, above its import.
    const UNITS = `#show: doc => [#doc]
Use $g = 9.8$ #unit("m/s^2") unless told otherwise.

#import "@preview/unify:0.8.1": num, qty, unit

A speed of #qty("3", "m/s").
`;
    const packages = () =>
      serverWith({ packages: { fetch: fetchVendored, cache: false }, allow: [...UNIVERSE_PACKAGES] });

    it("moves the import up in final mode and reports the source's error", async () => {
      const { compile } = await packages();
      const out = await unhurried(() => compile(ALKANES, { mode: "final", target: "paged" }));
      expect([out.result.status, out.compiles]).toEqual(["ok", 2]);
      expect(out.result.fixes).toEqual([{ fixer: "hoist-import", message: "unknown variable: cetz" }]);
      expect(out.diagnostics.map((d) => [d.severity, d.source, at(ALKANES, d)])).toEqual([["error", "typst", "cetz"]]);
      // Two chains drawn on the page.
      const svg = out.artifact?.target === "paged" ? (out.artifact.pages[0]?.svg ?? "") : "";
      expect(svg.match(/<path/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it("reports the move as info while streaming, and maps the document's positions back", async () => {
      const { compile } = await packages();
      const out = await unhurried(() => compile(UNITS, { settled: UNITS.length }));
      expect(out.result.status).toBe("ok");
      expect(out.diagnostics.map((d) => [d.severity, d.source, at(UNITS, d)])).toEqual([
        ["info", "hoist-import", "unit"],
      ]);
      expect(out.html).toContain("unless told otherwise");
      // `#unit("m/s^2")`, as unify writes it: m s⁻² in MathML.
      expect(out.html).toContain("<msup><mtext>s</mtext><mrow><mo>−</mo><mn>2</mn></mrow></msup>");
    });
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
    /** A server with CeTZ loaded and evaluated once: on a stopped clock, loading packages waits for them to arrive. */
    const cetz = async () => {
      const server = await serverWith({
        packages: { fetch: fetchVendored, cache: false },
        allow: [...UNIVERSE_PACKAGES],
      });
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

  describe("images", () => {
    const svg = (fill: string) =>
      new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="${fill}"/></svg>`,
      );
    /** The SVGs an HTML artifact shows, decoded from their data URLs. */
    const images = (html: string) =>
      [...html.matchAll(/src="data:image\/svg\+xml;base64,([^"]+)"/g)].map((m) =>
        Buffer.from(m[1] as string, "base64").toString(),
      );
    const open = async (text: string, files: Record<string, Uint8Array> = {}, params: Partial<CompileParams> = {}) => {
      const { client } = await serverWith();
      const uri = `img${Math.random()}`;
      await client.request("document/open", { uri, rev: 1, text, files });
      const out = await client.compile({ uri, rev: 1, target: "html", anchors: false, ...params });
      return { ...out, html: (out.artifact as HtmlArtifact | null)?.html ?? "" };
    };

    it("shows a placeholder with the caption, size and alt text of an image that isn't there", async () => {
      const text = '#figure(image("https://example.org/a/cell.png?w=2", width: 50%, alt: "A cell"), caption: [A cell])';
      const out = await open(text, {}, { settled: text.length });
      expect(out.result.status).toBe("ok");
      expect(out.html).toMatch(/<img src="data:image\/svg\+xml;base64,[^"]+" alt="A cell"[^>]*width: 50%/);
      // Typst joins the supplement and the number with a no-break space.
      expect(out.html).toMatch(/<figcaption>Figure.1: A cell<\/figcaption>/);
      expect(images(out.html)[0]).toContain(">cell.png</text>");
      expect(out.diagnostics.map((d) => [d.severity, d.source, at(text, d)])).toEqual([
        ["info", "missing-image", '"https://example.org/a/cell.png?w=2"'],
      ]);
    });

    it("shows the image once the file is there, under the URL as its path", async () => {
      const out = await open('#image("https://example.org/a/cell.svg")', {
        "https://example.org/a/cell.svg": svg("#123456"),
      });
      expect(out.result.status).toBe("ok");
      expect(out.result.fixes).toBeUndefined();
      expect(images(out.html)).toEqual([expect.stringContaining("#123456")]);
    });

    it("keeps a final document's missing image as an error next to the placeholder", async () => {
      const text = 'A #image("cat.png") here.';
      const out = await open(text, {}, { mode: "final" });
      expect(out.result.status).toBe("ok");
      expect(out.diagnostics.map((d) => [d.severity, d.message, at(text, d)])).toEqual([
        ["error", "file not found (searched at /cat.png)", '"cat.png"'],
      ]);
    });

    it("goes by the content of a file its extension misnames, and shows a placeholder for one that isn't an image", async () => {
      const misnamed = await open('#image("https://example.org/a.png")', {
        "https://example.org/a.png": svg("#abcdef"),
      });
      expect(misnamed.result.status).toBe("ok");
      expect(images(misnamed.html)).toEqual([expect.stringContaining("#abcdef")]);
      const broken = await open('#image("b.png")', { "b.png": new TextEncoder().encode("<html>404</html>") });
      expect(broken.result.status).toBe("ok");
      expect(broken.result.fixes?.map((f) => f.fixer)).toEqual(["missing-image", "missing-image"]);
      expect(images(broken.html)[0]).toContain(">b.png</text>");
    });

    it("stands placeholders in for every missing image before the first compile", async () => {
      const { compile } = await serverWith();
      const text = [1, 2, 3, 4].map((i) => `#image("https://x.org/${i}.png")`).join("\n\n");
      const out = await compile(text, { settled: text.length });
      expect(out.result.status).toBe("ok");
      // Typst stops at the first image it can't read: one fix round each would be too many.
      expect(out.compiles).toBe(1);
      expect(out.diagnostics.map((d) => [d.severity, d.source, d.message, at(text, d)])).toEqual(
        [1, 2, 3, 4].map((i) => [
          "info",
          "missing-image",
          `file not found (searched at /https:/x.org/${i}.png)`,
          `"https://x.org/${i}.png"`,
        ]),
      );
      expect(out.result.fixes).toHaveLength(4);
      // In final mode they are the errors Typst would report.
      const final = await compile(text, { mode: "final" });
      expect(final.result.status).toBe("ok");
      expect(final.diagnostics.map((d) => [d.severity, d.source])).toEqual(Array(4).fill(["error", "typst"]));
    });

    it("isolates a failing block next to a missing image, not the image's block", async () => {
      const { compile } = await serverWith();
      const text = '= One\n\n#image("cat.png", width: 2cm)\n\n= Two\n\n#nope\n\n= Three\n';
      const out = await compile(text, { mode: "final", fallback: { isolate: true } });
      expect(out.result.status).toBe("ok");
      expect(out.result.fallback?.isolated?.map((r) => text.slice(r.from, r.to).trim())).toEqual(["#nope"]);
      expect(images(out.html)[0]).toContain(">cat.png</text>");
      expect(out.html).toContain("Three");
    });

    it("leaves image calls in raw text and comments alone", async () => {
      const { compile } = await serverWith();
      const text = 'Write ```typ #image("cat.png")``` to show one. // #image("dog.png")\n/* image("cow.png") */';
      const out = await compile(text, { settled: text.length });
      expect(out.result.status).toBe("ok");
      expect(out.diagnostics).toEqual([]);
      expect(out.html).toContain("cat.png");
      expect(out.html).not.toContain("missing-image");
    });

    it("draws the placeholder in paged output too", async () => {
      const out = await open('#image("cat.png")', {}, { target: "paged" });
      expect(out.result.status).toBe("ok");
      expect(out.artifact?.target === "paged" && out.artifact.pageCount).toBe(1);
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
    // hoist-import: a function that uses a name bound after it
    "#let f() = x\n#let x = 1\n#f()",
    // missing-image: a path that isn't there, one being typed, a name holding it
    '#figure(image("cat.png", width: 50%), caption: [A cat])',
    '#image("https://exa")',
    '#let src = "x.png"\n#image(src)',
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
