// The text the engine compiles for the editor (compiled.ts): markers around calls, offsets between
// the two texts, and what Typst makes of it, compiled by engine-wasm: the same pages as the
// editor's own text, and labels still on what they labelled.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Engine, initSync } from "@typstream/engine-wasm";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, fromCompiled, MARKER, markersOf, toCompiled } from "../src/compiled";
import { DEFAULT_SCHEMA, EditorState } from "../src/index";
import { load } from "./support";

beforeAll(load);

initSync({ module: readFileSync(createRequire(import.meta.url).resolve("@typstream/engine-wasm/engine_bg.wasm")) });
for (const url of baseFonts) Engine.add_font(new Uint8Array(readFileSync(url)));

/** The pages Typst lays `source` out on (SVG), or its errors. */
const pages = (source: string): string[] => {
  const engine = new Engine();
  engine.set_source("/main.typ", source);
  const r = engine.compile_svg_changed();
  engine.free();
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return (r.changed ?? []).map((p) => p.svg);
};

/** `text` as the engine gets it from an editor without focus (no placeholder). */
const compiled = (text: string) => compile(new EditorState(text, { anchor: 0, head: 0 }), DEFAULT_SCHEMA, false);

describe("markers around calls", () => {
  it("go before the call's hash and after its end, not around text styles, rules or bindings", () => {
    expect(compiled("A #line(length: 2cm) B").text).toBe(`A ${MARKER}#line(length: 2cm)${MARKER} B`);
    expect(compiled("A #strong[b] #text(fill: red)[c]").text).toBe("A #strong[b] #text(fill: red)[c]");
    expect(compiled("#let f(x) = x\n#set text(size: 12pt)\n#show: it => it").text).toBe(
      "#let f(x) = x\n#set text(size: 12pt)\n#show: it => it",
    );
  });

  it("map offsets both ways, and are found from the call's range", () => {
    const text = "A #line(length: 2cm) B";
    const c = compiled(text);
    const [from, to] = [2, 20];
    expect(c.text.slice(toCompiled(c, from), toCompiled(c, from) + MARKER.length)).toBe(MARKER);
    expect(toCompiled(c, to)).toBe(to + 2 * MARKER.length);
    for (let at = 0; at <= text.length; at++) expect(fromCompiled(c, toCompiled(c, at))).toBe(at);
    expect(markersOf(c, from, to)).toEqual({ open: 2, close: 2 + MARKER.length + (to - from) });
  });
});

describe("a call's label", () => {
  const figure = "#figure(rect(width: 1cm), caption: [A box]) <fig-a>\n\nSee @fig-a.\n\n#show <fig-a>: set text(red)";

  it("stays the call's: the end marker goes after it", () => {
    const c = compiled(figure);
    expect(c.text).toBe(
      `${MARKER}#figure(rect(width: 1cm), caption: [A box]) <fig-a>${MARKER}\n\nSee @fig-a.\n\n#show <fig-a>: set text(red)`,
    );
    // Found from the call's own end all the same.
    const to = figure.indexOf(" <fig-a>");
    expect(markersOf(c, 0, to)).toEqual({ open: 0, close: MARKER.length + figure.indexOf("\n") });
    for (let at = 0; at <= figure.length; at++) expect(fromCompiled(c, toCompiled(c, at))).toBe(at);
  });

  it("may be on the next line, or after a blank one, as Typst reads it", () => {
    expect(compiled("#figure([x])\n<a>\n\n@a").text).toBe(`${MARKER}#figure([x])\n<a>${MARKER}\n\n@a`);
    expect(compiled("#figure([x])\n\n<a>\n\n@a").text).toBe(`${MARKER}#figure([x])\n\n<a>${MARKER}\n\n@a`);
    // Text between: the label is the text's.
    expect(compiled("#figure([x]) text <a>").text).toBe(`${MARKER}#figure([x])${MARKER} text <a>`);
  });

  it("can still be referenced, and the pages are the same", () => {
    expect(pages(compiled(figure).text)).toEqual(pages(figure));
    const next = "#figure([x], caption: [c])\n\n<a>\n\nSee @a.";
    expect(pages(compiled(next).text)).toEqual(pages(next));
  });
});

describe("the pages with markers", () => {
  it("are the pages without them", () => {
    for (const text of [
      "= Title\n\nText #box(width: 1cm, height: 1em, fill: red) more.\n\n#line(length: 100%)\n\n#table(columns: 2, [a], [b])",
      "A\n#pagebreak()\nB\n#pagebreak()",
      "#grid(columns: 2, [a], [#rect()])\n\n#align(center)[#circle(radius: 5pt)]",
    ])
      expect(pages(compiled(text).text), text).toEqual(pages(text));
  });

  it("gain no page after a column break ending the last column", () => {
    const text = "#set page(columns: 2, height: 6cm)\nA\n#colbreak()\nB\n#colbreak()\n";
    expect(pages(compiled(text).text)).toHaveLength(pages(text).length);
    expect(pages(text)).toHaveLength(1);
  });
});
