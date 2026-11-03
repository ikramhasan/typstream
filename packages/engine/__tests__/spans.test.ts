// Source spans in HTML compiles (`CompileParams.spans`, engine-wasm's spans.rs), for an editor over the HTML: taken
// off again, they change nothing; text in markup comes with exactly its characters' range; and through the server,
// ranges are in the document's text, past the preamble, the anchors and a fixer's changes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HtmlArtifact } from "@typstream/core";
import { type CorpusEntry, loadCorpus } from "@typstream/corpus";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngine, type EngineDocument } from "../src/index";
import type { EngineAdapter } from "../src/server/adapter";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

const edu = loadCorpus({ sets: ["edu"] });

const assets = (entry: CorpusEntry): Record<string, Uint8Array> => {
  const dir = join(dirname(entry.path), "assets");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).map((name) => [`/assets/${name}`, readFileSync(join(dir, name))]));
};

const TEXT = /<typstream-text data-src="(-?\d+) (-?\d+)">([^<]*)<\/typstream-text>/g;
const ELEMENT = / data-typstream-span="-?\d+ -?\d+"/g;

/** HTML with the spans taken off, as the renderer does. */
const strip = (html: string) => html.replace(TEXT, "$3").replace(ELEMENT, "");

/** Text in HTML is escaped; the source isn't. */
const unescapeHtml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** Every text piece with its range, and how many characters of them are exactly the source there. */
const pieces = (html: string, source: string) => {
  let chars = 0;
  let exact = 0;
  const all: { text: string; from: number; to: number }[] = [];
  for (const m of html.matchAll(TEXT)) {
    const text = unescapeHtml(m[3] as string);
    const [from, to] = [Number(m[1]), Number(m[2])];
    all.push({ text, from, to });
    chars += text.length;
    if (source.slice(from, to) === text) exact += text.length;
  }
  return { all, chars, exact };
};

describe("engine-wasm's spans", () => {
  let adapter: EngineAdapter;
  beforeAll(async () => {
    adapter = nodeEngineWasm();
    await adapter.init({});
  });

  it("change nothing but themselves, and give text in markup its own characters", async () => {
    let chars = 0;
    let exact = 0;
    for (const entry of edu) {
      const compiler = adapter.open();
      compiler.setFiles({ ...assets(entry), "/main.typ": entry.source });
      const plain = await compiler.compileHtml();
      const marked = await compiler.compileHtml({ spans: true });
      expect(marked.html && strip(marked.html), entry.id).toBe(plain.html);
      const found = pieces(marked.html ?? "", entry.source);
      for (const p of found.all) {
        expect(p.from, entry.id).toBeGreaterThanOrEqual(0);
        expect(p.to, entry.id).toBeLessThanOrEqual(entry.source.length);
      }
      chars += found.chars;
      exact += found.exact;
      compiler.close();
    }
    // Most text is markup, shown as written; not math's (𝑥 for `x`), nor text code computes (`s.at(0)`).
    expect(exact / chars).toBeGreaterThan(0.7);
  }, 120_000);

  it("give a node's range where the text isn't its characters", async () => {
    const compiler = adapter.open();
    const source = 'A "quote" -- and \\* and $x$.';
    compiler.setFiles({ "/main.typ": source });
    const { all } = pieces((await compiler.compileHtml({ spans: true })).html ?? "", source);
    const of = (text: string) => all.find((p) => p.text === text);
    expect(of("“")).toMatchObject({ from: 2, to: 3 });
    expect(of("–")).toMatchObject({ from: 10, to: 12 });
    expect(of("*")).toMatchObject({ from: 17, to: 19 });
    expect(of("quote")).toMatchObject({ from: 3, to: 8 });
    compiler.close();
  });

  it("give none to text code or math shows: its span is the expression", async () => {
    const compiler = adapter.open();
    const source = '#let who = "Ada"\n#let xs = ("one", "two")\nHello #who, #for x in xs [#x ] #"str" $y$ end.';
    compiler.setFiles({ "/main.typ": source });
    const html = (await compiler.compileHtml({ spans: true })).html ?? "";
    const texts = pieces(html, source).all.map((p) => p.text);
    for (const shown of ["Ada", "one", "two", "str", "𝑦"]) expect(texts, shown).not.toContain(shown);
    expect(texts).toContain("Hello");
    expect(texts).toContain("end.");
    compiler.close();
  });
});

const done = (doc: EngineDocument) =>
  new Promise<ReturnType<EngineDocument["getState"]>>((resolve) => {
    const check = (s: ReturnType<EngineDocument["getState"]>) => {
      if (s.status === "done" || s.status === "error") resolve(s);
    };
    doc.subscribe(check);
    check(doc.getState());
  });

describe("spans through the server", () => {
  it("are in the document's text: past the preamble, the layout profile and the anchors", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    for (const entry of edu.slice(0, 8)) {
      const doc = engine.open({ text: entry.source, spans: true, preamble: "#set text(size: 11pt)" });
      doc.finish();
      const state = await done(doc);
      const html = (state.artifact as HtmlArtifact).html;
      expect(html, entry.id).toContain("<typstream-anchor");
      const { all, chars, exact } = pieces(html, state.heal.source);
      if (all.length === 0) continue;
      // Pieces index the document's text: most are its characters there (see above).
      expect(exact / chars, entry.id).toBeGreaterThan(0.4);
      doc.dispose();
    }
    engine.dispose();
  }, 120_000);

  it("are in the document's text after a fixer changed it", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    // An image the document has no file for: a placeholder goes in before the text after it.
    const source = '#image("nope.png", width: 1cm)\n\nAfter the picture.';
    const doc = engine.open({ text: source, spans: true });
    doc.finish();
    const state = await done(doc);
    const html = (state.artifact as HtmlArtifact).html;
    const after = pieces(html, source).all.find((p) => p.text.startsWith("After"));
    expect(after && source.slice(after.from, after.to)).toBe("After the picture.");
    engine.dispose();
  }, 60_000);

  it("aren't in HTML compiled without them", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const doc = engine.open({ text: "= Plain\n\nText." });
    doc.finish();
    const html = ((await done(doc)).artifact as HtmlArtifact).html;
    expect(html).not.toContain("typstream-text");
    expect(html).not.toContain("data-typstream-span");
    engine.dispose();
  });
});
