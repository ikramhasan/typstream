// Plugins in the engine (PLAN §8.0, §11.3): a plugin with every facet loads
// through `createEngine` and `open`, its heal handlers, preamble, files and
// fixer modules all apply, and facets the engine doesn't read (`editor`, ones
// from a later version) are ignored.

import { readFileSync } from "node:fs";
import {
  definePlugin,
  type FontSource,
  type HealHandler,
  type HtmlArtifact,
  type TypstreamPlugin,
} from "@typstream/core";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { describe, expect, it } from "vitest";
import type { EngineDocument } from "../src/document";
import { createEngine, type EngineEvent } from "../src/engine";
import { documentOptions, initializeOptions } from "../src/plugins";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

const moduleUrl = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

/** Fixes `#nope` (an unknown variable) by writing the word. */
const NOPE = moduleUrl(`export default {
  name: "acme/no-nope",
  match: /^unknown variable: nope$/,
  fix: (d) => [{ from: d.span.from - 1, to: d.span.to, insert: "nope" }],
};`);

/** `[[blank]]` in markup → `#blank()`, the shorthand of PLAN §8.1. */
const blanks: HealHandler = {
  name: "acme/blanks",
  phase: "settled",
  run(ctx) {
    const edits = [];
    for (const m of ctx.text.slice(ctx.from, ctx.to).matchAll(/\[\[blank\]\]/g)) {
      const from = ctx.from + (m.index ?? 0);
      if (ctx.modeAt(from) === "markup") edits.push({ from, to: from + m[0].length, insert: "#blank()" });
    }
    return edits;
  },
};

const font: FontSource = { kind: "bytes", data: new Uint8Array(readFileSync(baseFonts[0] as URL)) };

const base = definePlugin({ key: "acme/base", engine: { preamble: "#let greeting = [Hello from base]" } });

const everything = definePlugin({
  key: "acme/everything",
  version: "1.0.0",
  dependencies: ["acme/base"],
  heal: { handlers: [blanks], lint: { "currency-dollar": "fix" } },
  engine: {
    fixerModules: [NOPE],
    files: { "/acme/lib.typ": "#let blank() = box(width: 3em, stroke: (bottom: 0.5pt))[BLANK]" },
    packages: [{ namespace: "preview", name: "cetz", version: "0.5.3" }],
    fonts: [font],
    preamble: '#import "/acme/lib.typ": blank',
  },
  templates: [{ name: "lab-report", preamble: '#set page(paper: "a5")' }],
  prompt: { catalogue: [{ name: "blank", signature: "blank() -> content", description: "A blank." }], rules: ["x"] },
  islands: { molecule: { description: "A molecule." } },
  sanitize: { allowTags: ["typstream-island"], allowAttrs: { "*": ["data-name"] } },
  stylesheets: [".typstream .blank { color: red }"],
  editor: { nodes: [{ call: "blank", label: "Blank" }], someFutureFacet: true },
});

/** A plugin from a later typstream, with a facet this one doesn't know. */
const future = { key: "acme/future", hologram: { depth: 3 } } as unknown as TypstreamPlugin;

const done = (doc: EngineDocument) =>
  new Promise<ReturnType<EngineDocument["getState"]>>((resolve) => {
    const check = (s: ReturnType<EngineDocument["getState"]>) => {
      if (s.status === "done" || s.status === "error") resolve(s);
    };
    doc.subscribe(check);
    check(doc.getState());
  });

const html = (s: ReturnType<EngineDocument["getState"]>) => (s.artifact as HtmlArtifact | null)?.html ?? "";

describe("plugins in the engine", { timeout: 30_000 }, () => {
  it("loads a plugin with every facet, after its dependency, and ignores unknown facets", async () => {
    const logs: EngineEvent[] = [];
    const engine = createEngine({
      spawn: inProcess(nodeEngineWasm),
      spare: false,
      plugins: [everything, base, future],
    });
    engine.onEvent((e) => e.type === "log" && logs.push(e));
    const doc = engine.open({
      plugins: [future, everything, base],
      text: "#greeting. Fill in [[blank]]. Say #nope.",
      // Without Layer 4, only the fixer can make it compile.
      fallback: false,
    });
    expect(doc.plugins.map((p) => p.key)).toEqual(["acme/future", "acme/base", "acme/everything"]);
    doc.finish();
    const state = await done(doc);
    expect(state.status).toBe("done");
    // The heal handler rewrote the shorthand; the preambles (base's first) and files defined what it calls.
    expect(doc.exportSource()).toBe("#greeting. Fill in #blank(). Say #nope.");
    expect(html(state)).toContain("Hello from base");
    expect(html(state)).toContain("BLANK");
    // The fixer module, loaded at `initialize`, fixed the unknown variable (final mode
    // still reports the error, for the LLM fix loop).
    expect(html(state)).toContain("Say nope.");
    expect(state.diagnostics.map((d) => d.message)).toEqual(["unknown variable: nope"]);
    // The engine has the plugin's fonts: no warning.
    expect(logs).toEqual([]);
    engine.dispose();
  });

  it("loads a document's fixer modules for that document only", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const plugin = definePlugin({ key: "acme/nope", engine: { fixerModules: [NOPE] } });
    const withPlugin = engine.open({ plugins: [plugin], text: "Say #nope.", fallback: false });
    const without = engine.open({ text: "Say #nope.", fallback: false });
    withPlugin.finish();
    without.finish();
    const [a, b] = await Promise.all([done(withPlugin), done(without)]);
    expect(html(a)).toContain("Say nope.");
    expect(b.status).toBe("error");
    expect(b.artifact).toBeNull();
    engine.dispose();
  });

  it("compiles without a document's fixer module that doesn't load, and logs why", async () => {
    const logs: string[] = [];
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    engine.onEvent((e) => e.type === "log" && logs.push(`${e.level}: ${e.message}`));
    const broken = definePlugin({ key: "acme/broken", engine: { fixerModules: [moduleUrl("export default 42;")] } });
    const doc = engine.open({ plugins: [broken], text: "= Fine" });
    doc.finish();
    const state = await done(doc);
    expect(state.status).toBe("done");
    expect(html(state)).toContain("Fine");
    expect(logs).toEqual([expect.stringMatching(/^error: .*fixer/)]);
    engine.dispose();
  });

  it("warns once about a document's plugin fonts the engine doesn't load", () => {
    const logs: EngineEvent[] = [];
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    engine.onEvent((e) => e.type === "log" && logs.push(e));
    const fonts = definePlugin({ key: "acme/fonts", engine: { fonts: [font] } });
    engine.open({ plugins: [fonts] });
    engine.open({ plugins: [fonts] });
    expect(logs).toEqual([
      expect.objectContaining({ level: "warn", message: expect.stringContaining('"acme/fonts"') }),
    ]);
    engine.dispose();
  });

  it("rejects plugins whose dependencies aren't loaded", () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    expect(() => engine.open({ plugins: [everything] })).toThrow(/"acme\/everything" depends on "acme\/base"/);
    engine.dispose();
    expect(() => createEngine({ spawn: inProcess(nodeEngineWasm), plugins: [everything] })).toThrow(/acme\/base/);
  });
});

describe("plugin facets", () => {
  it("adds plugins' fonts, packages and fixer modules to initialize's, each module once", () => {
    const cetz = { namespace: "preview", name: "cetz", version: "0.5.3" };
    const a = definePlugin({ key: "a", engine: { fixerModules: ["m1", "m2"], packages: [cetz] } });
    const b = definePlugin({ key: "b", engine: { fixerModules: ["m2"], fonts: [font] } });
    expect(initializeOptions({ fixerModules: ["m0", "m1"] }, [a, b])).toEqual({
      fixerModules: ["m0", "m1", "m2"],
      packages: [cetz],
      fonts: [font],
    });
    const initialize = { fixerModules: ["m0"] };
    expect(initializeOptions(initialize, [])).toBe(initialize);
    expect(initializeOptions(undefined, [definePlugin({ key: "c", templates: [] })])).toBeUndefined();
  });

  it("puts a document's own options after its plugins'", () => {
    const own: HealHandler = { name: "own", phase: "output", run: () => [] };
    const a = definePlugin({
      key: "a",
      heal: { handlers: [blanks], lint: { "currency-dollar": "fix", "markdown-bold": "warn" } },
      engine: { preamble: "#let a = 1", files: { "x.typ": "a", "y.typ": "a" }, fixerModules: ["m"] },
    });
    const b = definePlugin({
      key: "b",
      dependencies: ["a"],
      engine: { preamble: "#let b = 2", files: { "y.typ": "b" } },
    });
    const { options } = documentOptions(
      {
        plugins: [b, a],
        preamble: "#let own = 3",
        files: { "x.typ": "own" },
        heal: { handlers: [own], lint: { "markdown-bold": "off" } },
      },
      [],
    );
    expect(options.preamble).toBe("#let a = 1\n#let b = 2\n#let own = 3");
    expect(options.files).toEqual({ "x.typ": "own", "y.typ": "b" });
    expect(options.fixerModules).toEqual(["m"]);
    expect(options.heal?.handlers).toEqual([blanks, own]);
    expect(options.heal?.lint).toEqual({ "currency-dollar": "fix", "markdown-bold": "off" });
  });
});
