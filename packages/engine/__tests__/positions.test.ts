// Where the source was laid out on the pages (#36): with `positions`, a paged artifact says, for
// every page, which glyph clusters show which UTF-16 range of the client's text (past the preamble
// and the layout profile), and where the elements the document made start. The editor puts its
// caret, selection and clicks on them.
import type { PagedArtifact, PagePositions } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

interface Glyph {
  x: number;
  y: number;
  width: number;
  from: number;
  to: number;
  flags: number;
}

const glyphsOf = (p: PagePositions): Glyph[] => {
  const f = new Float32Array(p.glyphs.buffer, p.glyphs.byteOffset, p.glyphs.byteLength >> 2);
  const out: Glyph[] = [];
  for (let i = 0; i < f.length; i += 8) {
    out.push({
      x: f[i] as number,
      y: f[i + 1] as number,
      width: f[i + 2] as number,
      from: f[i + 5] as number,
      to: f[i + 6] as number,
      flags: f[i + 7] as number,
    });
  }
  return out;
};

const PREAMBLE = "#set page(width: 300pt, height: 200pt, margin: 20pt)\n";

const open = (text: string) => {
  const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
  const doc = engine.open({ target: "paged", preamble: PREAMBLE, text, positions: true, pageFormat: "drawing" });
  doc.finish();
  const done = () =>
    new Promise<PagedArtifact>((resolve) => {
      const stop = doc.subscribe((s) => {
        if (s.status !== "done") return;
        stop();
        expect(s.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        resolve(s.artifact as PagedArtifact);
      });
    });
  return { engine, doc, done };
};

describe("positions in paged artifacts", () => {
  it("map each glyph to the characters of the client's text it shows", async () => {
    const text = "= Title\n\nHello *bold* world, fine.\n\n#pagebreak()\nSecond page.";
    const { engine, done } = open(text);
    const artifact = await done();
    engine.dispose();
    expect(artifact.positions).toHaveLength(2);
    const [first, second] = (artifact.positions as PagePositions[]).map(glyphsOf);
    const shown = (gs: Glyph[]) =>
      gs
        .filter((g) => g.from >= 0)
        .map((g) => text.slice(g.from, g.to))
        .join("");
    expect(shown(first as Glyph[])).toBe("TitleHello bold world, fine.");
    expect(shown(second as Glyph[])).toBe("Second page.");
    // Exact ranges, in order along the line: "fi" is one glyph (a ligature) showing two characters.
    const fi = (first as Glyph[]).find((g) => text.slice(g.from, g.to) === "fi");
    expect(fi?.flags).toBe(1);
    const bold = text.indexOf("bold");
    const b = (first as Glyph[]).find((g) => g.from === bold);
    const o = (first as Glyph[]).find((g) => g.from === bold + 1);
    expect(o?.x).toBeCloseTo((b?.x as number) + (b?.width as number), 3);
  });

  it("are every page's after an edit, with the offsets after it moved", async () => {
    const text = "First.\n\n#pagebreak()\nSecond page.";
    const { engine, doc, done } = open(text);
    await done();
    doc.applyEdit({ from: 0, to: 0, insert: "Very " });
    const artifact = await done();
    engine.dispose();
    const second = glyphsOf((artifact.positions as PagePositions[])[1] as PagePositions);
    const edited = `Very ${text}`;
    expect(second[0]?.from).toBe(edited.indexOf("Second"));
  });

  it("place table cells, empty ones too, with their column and row", async () => {
    const text = "#table(columns: 2, [a], [], [c], [d])";
    const { engine, done } = open(text);
    const artifact = await done();
    engine.dispose();
    const cells = (artifact.positions as PagePositions[])[0]?.elements.filter((e) => e.kind === "cell");
    expect(cells?.map((c) => [text.slice(c.from, c.to), c.cell])).toEqual([
      ["a", [0, 0]],
      ["[]", [1, 0]],
      ["c", [0, 1]],
      ["d", [1, 1]],
    ]);
    expect(cells?.[1]?.x).toBeGreaterThan(cells?.[0]?.x as number);
    expect(cells?.[2]?.y).toBeGreaterThan(cells?.[0]?.y as number);
  });

  it("are left out unless asked for", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const doc = engine.open({ target: "paged", text: "Hi." });
    doc.finish();
    const state = await new Promise<ReturnType<typeof doc.getState>>((resolve) => {
      doc.subscribe((s) => s.status === "done" && resolve(s));
    });
    engine.dispose();
    expect((state.artifact as PagedArtifact).positions).toBeUndefined();
  });
});
