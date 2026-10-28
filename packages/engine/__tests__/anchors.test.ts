// Source anchors (PLAN §10.2): where they go, how positions map back, and that
// they change nothing but themselves: over the corpus and streamed prefixes of
// it, HTML with the anchors stripped is byte-identical to HTML without them,
// and diagnostics map back to the same positions.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ClientMessage, Diagnostic, ServerMessage } from "@typstream/core";
import { type CorpusEntry, loadCorpus, streamOf } from "@typstream/corpus";
import { anchorPoints, createHealer, heal, recognize } from "@typstream/heal";
import { beforeAll, describe, expect, it } from "vitest";
import type { AdapterDocument, EngineAdapter } from "../src/server/adapter";
import { Anchors, anchorText, fromAnchored, insertAnchors } from "../src/server/anchors";
import { createServer } from "../src/server/server";
import { nodeEngineWasm } from "./support/engine-wasm";

const points = (text: string) => anchorPoints(text, recognize(text).checkpoints);
/** The lines that get an anchor, as text. */
const anchoredLines = (text: string) => points(text).map((p) => text.slice(p, text.indexOf("\n", p) >>> 0));

const ANCHOR = /<typstream-anchor data-src="\d+"><\/typstream-anchor>/g;

describe("anchorPoints", () => {
  it("anchors block starts: the start, after blank lines, and headings", () => {
    const text = "Intro\nstill intro\n\nSecond\n= Heading\nBody\n\n\n#figure[x]\n";
    expect(anchoredLines(text)).toEqual(["Intro", "Second", "= Heading", "#figure[x]"]);
  });

  it("anchors the first item of a list, not later items of the same list", () => {
    expect(anchoredLines("- a\n\n- b\n\n+ c\n\n2. d\n\n/ t: e\n\n/ u: f\n")).toEqual(["- a", "+ c", "/ t: e"]);
  });

  it("anchors a list after a different kind of block", () => {
    expect(anchoredLines("Para\n\n- a\n\nText\n\n- b\n")).toEqual(["Para", "- a", "Text", "- b"]);
  });

  it("skips lines starting with a label, which would attach to the anchor", () => {
    expect(anchoredLines("= A\n\n<sec-a>\n\nText\n")).toEqual(["= A", "Text"]);
  });

  it("puts the anchor before the line's indentation and skips markers that aren't markers", () => {
    expect(points("x\n\n  - a\n")).toEqual([0, 3]);
    expect(anchoredLines("x\n\n-5 degrees\n\n=no heading\n")).toEqual(["x", "-5 degrees", "=no heading"]);
  });

  it("ignores lines inside content blocks and text brackets", () => {
    expect(anchoredLines("#[\n\nInner\n]\n\nOuter [\n\nbracket]\n")).toEqual(["#[", "Outer ["]);
  });
});

describe("fromAnchored", () => {
  it("maps positions past anchors back and positions inside them to their line", () => {
    const text = "= A\n\nBody\n";
    const a = insertAnchors(text, [0, 5]);
    const first = anchorText(0).length;
    const second = anchorText(5).length;
    expect(a.text).toBe(`${anchorText(0)}= A\n\n${anchorText(5)}Body\n`);
    expect(fromAnchored(a, 0)).toBe(0);
    expect(fromAnchored(a, first - 1)).toBe(0);
    expect(fromAnchored(a, first + 2)).toBe(2);
    expect(fromAnchored(a, first + 5 + 3)).toBe(5);
    expect(fromAnchored(a, first + 5 + second + 1)).toBe(6);
    for (let pos = 0; pos <= text.length; pos++) {
      const inAnchored = pos + first + (pos >= 5 ? second : 0);
      expect(a.text[inAnchored]).toBe(text[pos]);
      expect(fromAnchored(a, inAnchored)).toBe(pos);
    }
  });
});

const edu = loadCorpus({ sets: ["edu"] });

const commonPrefix = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};

describe("Anchors", () => {
  it("re-recognizing from before each change equals anchoring from scratch", () => {
    for (const entry of edu) {
      const anchors = new Anchors();
      const healer = createHealer();
      let previous = "";
      for (const chunk of streamOf(entry)) {
        const healed = healer.push(chunk.text).source;
        anchors.changed(commonPrefix(previous, healed));
        expect(anchors.apply(healed), `${entry.id} at ${healer.input.length}`).toEqual(new Anchors().apply(healed));
        previous = healed;
      }
    }
  }, 120_000);
});

// --- engine-wasm ------------------------------------------------------------------

const assets = (entry: CorpusEntry): Record<string, Uint8Array> => {
  const dir = join(dirname(entry.path), "assets");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).map((name) => [`/assets/${name}`, readFileSync(join(dir, name))]));
};

const without = (d: Diagnostic) => ({ ...d, hints: [] });

describe("anchored compiles", () => {
  let adapter: EngineAdapter;
  beforeAll(async () => {
    adapter = nodeEngineWasm();
    await adapter.init({});
  });

  /** Compiles `text` with and without anchors and checks they agree. Returns the anchor count. */
  const check = async (compiler: AdapterDocument, text: string, label: string): Promise<number> => {
    compiler.setFiles({ "/main.typ": text });
    const plain = await compiler.compileHtml();
    const anchored = new Anchors().apply(text);
    compiler.setFiles({ "/main.typ": anchored.text });
    const withAnchors = await compiler.compileHtml();
    expect(withAnchors.html?.replace(ANCHOR, "") ?? null, label).toBe(plain.html);
    const mapped = withAnchors.diagnostics.map((d) => ({
      ...d,
      span: d.span && { from: fromAnchored(anchored, d.span.from), to: fromAnchored(anchored, d.span.to) },
      trace: d.trace.map((t) => ({
        ...t,
        span: t.span && { from: fromAnchored(anchored, t.span.from), to: fromAnchored(anchored, t.span.to) },
      })),
    }));
    expect(mapped.map(without), label).toEqual(plain.diagnostics.map(without));
    return withAnchors.html?.match(ANCHOR)?.length ?? 0;
  };

  it("change nothing but themselves in corpus documents", async () => {
    for (const entry of edu) {
      const compiler = adapter.open();
      compiler.setFiles(assets(entry));
      const count = await check(compiler, entry.source, entry.id);
      expect(count, entry.id).toBe(points(entry.source).length);
      compiler.close();
    }
  }, 120_000);

  it("change nothing but themselves in healed stream prefixes", async () => {
    for (const entry of edu) {
      const compiler = adapter.open();
      compiler.setFiles(assets(entry));
      const chunks = streamOf(entry);
      const step = Math.max(1, Math.floor(chunks.length / 12));
      let input = "";
      for (let i = 0; i < chunks.length; i++) {
        input += (chunks[i] as { text: string }).text;
        if (i % step === 0) await check(compiler, heal(input).source, `${entry.id} at ${input.length}`);
      }
      compiler.close();
    }
  }, 300_000);
});

// --- server -------------------------------------------------------------------------

describe("server", () => {
  /** A server over an adapter that echoes `/main.typ`, and the texts it compiled. */
  const echo = () => {
    const compiled: { kind: string; main: string }[] = [];
    const adapter: EngineAdapter = {
      info: { name: "echo", typstVersion: "0.15.1" },
      targets: ["html", "paged"],
      exports: ["html"],
      init: async () => {},
      open: () => {
        let main = "";
        return {
          setFiles: (files) => {
            if (typeof files["/main.typ"] === "string") main = files["/main.typ"];
          },
          setInputs: () => {},
          compileHtml: (options) => {
            compiled.push({ kind: options?.mode === "final" ? "export" : "html", main });
            return {
              html: "<p></p>",
              diagnostics: [
                {
                  severity: "error",
                  span: { from: main.indexOf("Body"), to: main.indexOf("Body") + 4 },
                  message: "m",
                  hints: [],
                  trace: [],
                },
              ],
            };
          },
          compilePaged: () => {
            compiled.push({ kind: "paged", main });
            return { output: { pageCount: 0, changed: [] }, diagnostics: [] };
          },
          close: () => {},
        };
      },
    };
    const out: ServerMessage[] = [];
    const server = createServer(adapter, (m) => out.push(m));
    let id = 0;
    const send = async (method: string, params: unknown): Promise<unknown> => {
      const requestId = ++id;
      server.receive({ id: requestId, method, params } as ClientMessage);
      await new Promise((r) => setTimeout(r, 0));
      const reply = out.find((m) => "id" in m && m.id === requestId) as { result?: unknown; error?: unknown };
      if (reply.error) throw new Error(JSON.stringify(reply.error));
      return reply.result;
    };
    return { compiled, out, send };
  };

  it("anchors HTML compiles only, and maps diagnostics back", async () => {
    const { compiled, out, send } = echo();
    await send("initialize", { protocolVersion: 1 });
    const uri = "doc";
    await send("document/open", { uri, rev: 1, text: "= A\n\nBody\n", preamble: "#let x = 1" });
    await send("compile", { uri, rev: 1, target: "html" });
    await send("compile", { uri, rev: 1, target: "html", anchors: false });
    await send("compile", { uri, rev: 1, target: "paged" });
    await send("export/html", { uri, rev: 1 });
    await send("document/edit", { uri, rev: 2, edits: [{ from: 10, to: 10, insert: "\nMore\n" }] });
    await send("compile", { uri, rev: 2, target: "html" });
    const prefix = "#let x = 1\n";
    expect(compiled).toEqual([
      { kind: "html", main: `${prefix}${anchorText(0)}= A\n\n${anchorText(5)}Body\n` },
      { kind: "html", main: `${prefix}= A\n\nBody\n` },
      { kind: "paged", main: `${prefix}= A\n\nBody\n` },
      { kind: "export", main: `${prefix}= A\n\nBody\n` },
      { kind: "html", main: `${prefix}${anchorText(0)}= A\n\n${anchorText(5)}Body\n\n${anchorText(11)}More\n` },
    ]);
    const spans = out.flatMap((m) =>
      "method" in m && m.method === "document/diagnostics" && m.params.target === "html"
        ? m.params.diagnostics.map((d) => d.span)
        : [],
    );
    expect(spans).toEqual([
      { from: 5, to: 9 },
      { from: 5, to: 9 },
      { from: 5, to: 9 },
    ]);
  });
});
