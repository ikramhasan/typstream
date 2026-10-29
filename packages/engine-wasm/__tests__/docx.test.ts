// The DOCX export's document model (`compile_docx_model`, #131): what tools/docx-check measures for the Latin corpus
// (layout against Typst's PDF), here for every script and for what that check can't see.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, newEngine } from "./support/engine.js";

const engine = newEngine();
const dist = new URL("../dist/", import.meta.url);
for (const f of readdirSync(new URL("fonts/", dist)))
  if (f.startsWith("Noto")) Engine.add_font(readFileSync(new URL(`fonts/${f}`, dist)));

const model = (source: string) => {
  engine.set_source("/main.typ", source + Engine.docx_margin_probe());
  const result = engine.compile_docx_model();
  expect(result.ok, result.diagnostics.map((d) => d.message).join("; ")).toBe(true);
  return JSON.parse(result.model as string);
};

describe("compile_docx_model", () => {
  it("reads every edu corpus document that compiles, in every script", () => {
    const corpus = new URL("../../../corpus/edu/", import.meta.url);
    for (const f of readdirSync(new URL("assets/", corpus)))
      engine.set_file(`/assets/${f}`, readFileSync(new URL(`assets/${f}`, corpus)));
    let read = 0;
    for (const name of readdirSync(corpus).filter((n) => n.endsWith(".typ"))) {
      const source = readFileSync(new URL(name, corpus), "utf8");
      engine.set_source("/main.typ", source);
      if (!engine.check_paged().ok) continue;
      expect(model(source).sections, name).toHaveLength(1);
      read++;
    }
    expect(read).toBeGreaterThan(20);
  });

  it("orders a line's pieces whose baselines creep apart (a sort by baselines within a tolerance panicked)", () => {
    // Each box sits 0.3 pt lower than the one before: neighbours share a line, the first and the third don't.
    const boxes = Array.from({ length: 60 }, (_, i) => `#box(baseline: ${(i % 7) * 0.3}pt)[w${i}]`).join(" ");
    const runs = model(`${boxes}\n`).sections[0].blocks.flatMap((b: { runs?: { text?: string }[] }) => b.runs ?? []);
    expect(runs.map((r: { text?: string }) => r.text ?? "").join("")).toContain("w0");
  });

  it("makes a picture of a drawing, SVG and PNG, with a stroke outside its view box for LibreOffice", () => {
    engine.set_source(
      "/main.typ",
      `#box(width: 2cm, height: 1cm, place(circle(radius: 0.4cm, stroke: 1pt)))${Engine.docx_margin_probe()}`,
    );
    const result = engine.compile_docx_model();
    const pictures = result.pictures ?? [];
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.svg).toMatch(
      /^<svg [^>]*><path fill="none" stroke="#000000" stroke-width="0.01" d="M -1 -1 h 0.01"\/>/,
    );
    expect([...(pictures[0]?.png ?? []).slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    // As big as the box (2 by 1 cm), and half the 1 pt stroke more at the top and left, where the circle touches it.
    const [p] = JSON.parse(result.model as string).pictures;
    expect(p.width).toBeCloseTo(56.69 + 0.5, 1);
    expect(p.height).toBeCloseTo(28.35 + 0.5, 1);
  });
});
