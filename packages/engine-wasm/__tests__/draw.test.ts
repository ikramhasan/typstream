// Pages as drawings for a canvas (`compile_svg_changed(true)`, src/draw.rs,
// #14). Each drawing is checked against typst-svg's SVG of the same page: the
// same glyphs, shapes, clips, images and links, item for item. The browser
// tests in @typstream/dom compare the painted pixels.

import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChangedPage, PageDrawing } from "../dist/engine.js";
import { benchDoc } from "./support/documents.js";
import { Engine, newEngine } from "./support/engine.js";

const engine = newEngine();

const pagesOf = (source: string, drawings = true): ChangedPage[] => {
  engine.set_source("/main.typ", source);
  engine.reset_pages();
  const result = engine.compile_svg_changed(drawings);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  return result.changed ?? [];
};

/** What a drawing draws, decoded as `src/draw.rs` describes and `@typstream/dom` paints it. */
const decode = (drawing: PageDrawing) => {
  expect(drawing.ops.byteOffset % 4).toBe(0);
  expect(drawing.ops.byteLength % 4).toBe(0);
  const ops = new Float32Array(drawing.ops.buffer, drawing.ops.byteOffset, drawing.ops.byteLength / 4);
  const out = { glyphs: 0, shapes: 0, clips: 0, images: [] as string[], fills: new Set<string>() };
  let i = 0;
  const next = () => ops[i++] as number;
  const str = (n: number) => {
    expect(Number.isInteger(n) && n >= 0 && n < drawing.strings.length, `string ${n}`).toBe(true);
    return drawing.strings[n] as string;
  };
  const transform = () => {
    for (let k = 0; k < 6; k++) expect(Number.isFinite(next())).toBe(true);
  };
  const stroke = () => {
    const color = next();
    if (color < 0) return;
    str(color);
    const [width, cap, join, miter, n] = [next(), next(), next(), next(), next()];
    expect(width).toBeGreaterThanOrEqual(0);
    expect([cap, join]).toEqual([expect.any(Number), expect.any(Number)]);
    expect(cap <= 2 && join <= 2 && miter >= 1).toBe(true);
    i += n + 1;
  };
  let depth = 0;
  while (i < ops.length) {
    const op = next();
    if (op === 1) {
      transform();
      str(next());
      out.clips++;
      depth++;
    } else if (op === 2) {
      depth--;
    } else if (op === 3) {
      transform();
      out.fills.add(str(next()));
      stroke();
      for (let n = next(); n > 0; n--) {
        const glyph = next();
        expect(glyph < drawing.glyphs.length).toBe(true);
        i += 2;
        out.glyphs++;
      }
    } else if (op === 4) {
      transform();
      str(next());
      const fill = next();
      if (fill >= 0) out.fills.add(str(fill));
      i++;
      stroke();
      out.shapes++;
    } else if (op === 5) {
      transform();
      out.images.push(str(next()));
      i += 3;
    } else throw new Error(`unknown op ${op} at ${i - 1}`);
  }
  expect(depth).toBe(0);
  expect(i).toBe(ops.length);
  return out;
};

/** What typst-svg's SVG of a page draws: elements outside `<defs>` (glyph symbols, clip paths). */
const svgItems = (svg: string) => {
  const body = svg.slice(0, svg.indexOf("<defs") >= 0 ? svg.indexOf("<defs") : svg.length);
  const count = (re: RegExp) => body.match(re)?.length ?? 0;
  return {
    glyphs: count(/<use /g),
    shapes: count(/<path /g),
    clips: count(/clip-path="/g),
    images: count(/<image /g),
    links: count(/<a [^>]*href="(https?|mailto):/g),
  };
};

/** Compiles `source` both ways and checks each drawn page against its SVG. */
const same = (source: string) => {
  const drawn = pagesOf(source);
  const svg = pagesOf(source, false);
  expect(drawn.map((p) => p.hash)).toEqual(svg.map((p) => p.hash));
  for (const [i, page] of drawn.entries()) {
    const reference = svg[i] as ChangedPage;
    if (!page.drawing) {
      expect(page.svg).toBe(reference.svg);
      continue;
    }
    expect(page.svg).toBe("");
    const items = decode(page.drawing);
    const want = svgItems(reference.svg);
    expect({
      glyphs: items.glyphs,
      shapes: items.shapes,
      clips: items.clips,
      images: items.images.length,
      links: page.drawing.links.filter((l) => /^(https?|mailto):/.test(l.url)).length,
    }).toEqual(want);
    // The text layer is the same either way.
    expect(page.text).toEqual(reference.text);
  }
  return drawn;
};

describe("page drawings", () => {
  beforeEach(() => engine.reset_pages());

  it("draws what the SVG draws, item for item: text, math, tables, lists", () => {
    const pages = same(benchDoc());
    expect(pages.every((p) => p.drawing)).toBe(true);
    // One outline per glyph and font, shared by every page that draws it.
    const outlines = new Map<string, string>();
    for (const page of pages)
      for (const [key, path] of page.drawing?.glyphs ?? []) {
        expect(path).toMatch(/^M/);
        if (outlines.has(key)) expect(outlines.get(key)).toBe(path);
        outlines.set(key, path);
      }
    expect(outlines.size).toBeGreaterThan(100);
  });

  it("draws shapes, strokes, clips, transforms, images and links", () => {
    // A 1×1 PNG.
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    engine.set_file("/dot.png", png);
    const [page] = same(`#set page(width: 300pt, height: 400pt, fill: rgb("#fffbe6"))
Text #text(fill: rgb("#2a7"))[green] and $x^2$.
#rect(width: 90pt, height: 26pt, radius: 4pt, fill: rgb("#3366cc80"), stroke: (paint: red, thickness: 2pt, dash: "dashed"))
#box(width: 70pt, height: 14pt, clip: true)[#text(size: 26pt)[Clipped text]]
#box(rotate(25deg)[Rotated]) #box(scale(x: 160%)[Scaled])
#text(stroke: 0.6pt + blue, fill: yellow, size: 26pt)[Outlined]
#polygon(fill: black, fill-rule: "even-odd", (0pt, 20pt), (40pt, 20pt), (8pt, 45pt), (20pt, 5pt), (32pt, 45pt))
#line(length: 120pt, stroke: (thickness: 5pt, cap: "round"))
#image("dot.png", width: 20pt) #link("https://typst.app")[a link] #link("javascript:alert(1)")[as written]`);
    const drawing = page?.drawing as PageDrawing;
    const items = decode(drawing);
    expect(items.clips).toBe(1);
    expect(items.images).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
    // Colours as typst-svg writes them, alpha included.
    expect([...items.fills]).toEqual(expect.arrayContaining(["#fffbe6", "#22aa77", "#3366cc80", "#ffdc00"]));
    // Links as the document wrote them (the renderer judges them), in page points.
    expect(drawing.links.map((l) => l.url)).toEqual(["https://typst.app", "javascript:alert(1)"]);
    for (const l of drawing.links) {
      expect(l.x).toBeGreaterThan(0);
      expect(l.x + l.width).toBeLessThanOrEqual(300);
      expect(l.height).toBeGreaterThan(5);
    }
  });

  it("sends pages it can't draw as SVG: gradients, tilings", () => {
    const pages = same(`Plain.
#pagebreak()
#rect(width: 40pt, height: 20pt, fill: gradient.linear(red, blue))
#pagebreak()
#text(fill: tiling(size: (4pt, 4pt), square(size: 2pt)))[Tiled]
#pagebreak()
#rect(stroke: gradient.radial(red, blue) + 2pt)[Stroked]`);
    expect(pages.map((p) => !!p.drawing)).toEqual([true, false, false, false]);
  });

  it("draws every page of the edu corpus that its SVG draws without gradients or tilings", () => {
    const corpus = new URL("../../../corpus/edu/", import.meta.url);
    for (const f of readdirSync(new URL("assets/", corpus)))
      engine.set_file(`/assets/${f}`, readFileSync(new URL(`assets/${f}`, corpus)));
    for (const f of readdirSync(new URL("fonts/", new URL("../dist/", import.meta.url))))
      if (f.startsWith("Noto"))
        Engine.add_font(readFileSync(new URL(`fonts/${f}`, new URL("../dist/", import.meta.url))));
    let drawn = 0;
    let total = 0;
    for (const name of readdirSync(corpus).filter((n) => n.endsWith(".typ"))) {
      const source = readFileSync(new URL(name, corpus), "utf8");
      engine.set_source("/main.typ", source);
      if (!engine.check_paged().ok) continue;
      for (const page of same(source)) {
        total++;
        if (page.drawing) drawn++;
        else expect(page.svg, `${name} page ${page.index + 1}`).toMatch(/Gradient|<pattern/);
      }
    }
    expect(drawn).toBeGreaterThan(0);
    expect(drawn / total).toBeGreaterThan(0.9);
  });

  it("diffs pages as SVG does", () => {
    engine.set_source("/main.typ", benchDoc());
    expect(engine.compile_svg_changed(true).changed?.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
    engine.set_source("/main.typ", `${benchDoc()}\nOne more streamed sentence.`);
    const appended = engine.compile_svg_changed(true);
    expect(appended.changed?.map((p) => p.index)).toEqual([5]);
    expect(appended.changed?.[0]?.drawing).toBeDefined();
  });
});
