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

  describe("scripts (#134)", () => {
    type Run = { text?: string; rtl?: boolean; lang?: string; gap?: number };
    type Block = { type: string; rtl?: boolean; runs?: Run[]; list?: { id: number; label: string }; rows?: unknown[] };
    const blocks = (source: string): Block[] => model(source).sections[0].blocks;
    const text = (b?: Block) => (b?.runs ?? []).map((r) => r.text ?? "").join("");

    it("writes Arabic in logical order, right to left, with a left-to-right word in place", () => {
      const sentence = "لماذا تبدو الشمس أكبر؟ استخدم كلمة distance (المسافة) في إجابتك.";
      const [title, line] = blocks(`#set text(lang: "ar")\n= اختبار قصير: الجهاز الشمسي\n\n${sentence}\n`);
      // Its dots are items of their own in Typst's frames, each repeating its letter: they are drawn, not written.
      expect(text(title)).toBe("اختبار قصير: الجهاز الشمسي");
      expect(title?.rtl).toBe(true);
      expect(text(line)).toBe(sentence);
      expect(line?.runs?.find((r) => r.text === "distance")).not.toHaveProperty("rtl");
      expect(
        line?.runs?.filter((r) => /[\u0600-\u06ff]/.test(r.text ?? "")).every((r) => r.rtl && r.lang === "ar"),
      ).toBe(true);
    });

    it("writes a left-to-right paragraph in a right-to-left document left to right", () => {
      const note = "Teacher note (left to right): answers 1-ب، 2-ب. Jupiter is 5th.";
      const [p] = blocks(`#set text(lang: "ar")\n#text(dir: ltr)[${note}]\n`);
      expect(text(p)).toBe(note);
      expect(p?.rtl).toBeUndefined();
    });

    it("writes Bengali and Devanagari once, though Typst draws vowel signs apart", () => {
      for (const words of ["গুণের অনুশীলনী: তৃতীয় শ্রেণি", "विज्ञान कार्यपत्रक: पदार्थ की अवस्थाएँ"])
        expect(text(blocks(`${words}\n`)[0])).toBe(words);
    });

    it("measures a right-to-left list's labels from the right", () => {
      const out = blocks(`#set text(lang: "ar")\n- الزهرة\n- عطارد\n`);
      expect(out.map(text)).toEqual(["الزهرة", "عطارد"]);
      expect(out.every((b) => b.rtl && b.list?.label === "•")).toBe(true);
      const list = model(`#set text(lang: "ar")\n- الزهرة\n`).lists[0];
      expect(list.labelLeft).toBeCloseTo(0, 0);
      expect(list.bodyLeft).toBeGreaterThan(list.labelRight);
    });

    it("numbers a right-to-left table's columns as drawn, left to right", () => {
      const [table] = blocks(`#set text(lang: "ar")\n#table(columns: 3, [أ], [ب], [ج])\n`);
      const cells = (table?.rows?.[0] as { cells: { col: number; blocks: Block[] }[] }).cells;
      expect(cells.map((c) => [c.col, text(c.blocks[0])]).sort()).toEqual([
        [0, "ج"],
        [1, "ب"],
        [2, "أ"],
      ]);
    });

    it("writes labels Word has no numbering for as text, and Devanagari page numbers as Word's Hindi numbers", () => {
      const out = model(`#set page(numbering: "१")\n#set enum(numbering: "১.")\n+ এক\n+ দুই\n`);
      expect(out.lists[0].format).toBe("none");
      expect(out.sections[0].pageNumbering).toEqual({ format: "hindiNumbers", start: 1 });
    });
  });

  describe("rules, borders and blanks where Typst draws them (tools/conformance's ink check)", () => {
    type Run = { text?: string; gap?: number; underline?: boolean; raise?: number; tab?: boolean; picture?: Picture };
    type Picture = { index: number; y: number; line?: number };
    type Cell = { margins: Record<string, number>; borders: Record<string, unknown>; blocks: Block[] };
    type Block = {
      type: string;
      before?: number;
      runs?: Run[];
      rows?: { pageBreak?: boolean; cells: Cell[] }[];
      indent?: number;
      height?: number;
      breakable?: boolean;
    };
    // The layout profile's lines (packages/engine's LAYOUT_PROFILE): the line boxes the model measures from.
    const PROFILE =
      "#show text: set text(top-edge: 1.054em, bottom-edge: -0.246em)\n#set par(leading: 0pt, spacing: 0.56em)\n";
    const blocks = (source: string): Block[] => model(source).sections[0].blocks;

    it("raises a blank drawn on the baseline so its underline lands there, and leaves edu's at the underline", () => {
      const [own, edu] = blocks(
        "I #box(width: 3cm, stroke: (bottom: 0.5pt)) went.\n\nI #box(width: 3cm, height: 0.3em, baseline: 0.078em, stroke: (bottom: 0.5pt)) went.\n",
      );
      // Libertinus Serif's underline is 0.078em below the baseline (its post table): 0.86 pt at 11 pt.
      expect(own?.runs?.[1]).toMatchObject({ gap: 85.04, underline: true, raise: 0.86 });
      expect(edu?.runs?.[1]).toMatchObject({ gap: 85.04, underline: true });
      expect(edu?.runs?.[1]).not.toHaveProperty("raise");
    });

    it("keeps a blank next to h(1fr) underlined, and the room after it a tab", () => {
      const [line] = blocks(
        "Name: #box(width: 4cm, stroke: (bottom: 0.5pt)) #h(1fr) Date: #box(width: 2cm, stroke: (bottom: 0.5pt))\n",
      );
      expect(
        line?.runs?.map((r) => (r.tab ? "tab" : r.gap ? `gap ${r.gap}${r.underline ? " underlined" : ""}` : r.text)),
      ).toEqual(["Name: ", "gap 113.39 underlined", "tab", "Date: ", "gap 56.69 underlined"]);
    });

    it("takes the half of a rule's stroke Typst draws in the gap after it off the next gap", () => {
      const out = blocks(
        `${PROFILE}#set enum(spacing: 0pt)\n${[1, 2, 3].map((i) => `+ Item ${i}. #line(length: 3cm, stroke: 2pt)\n`).join("")}+ Last.\n`,
      );
      const rules = out.filter((b) => b.type === "rule");
      // Typst's line has no height, the rule is as tall as the stroke: the item after it starts half of it higher.
      expect(rules.map((r) => r.before)).toEqual([5.16, 4.16, 4.16]);
    });

    it("gives a table's cells their borders where it goes on to another page", () => {
      const [table] = blocks(
        "#set page(height: 200pt)\n#v(80pt)\n#table(columns: 2, ..range(16).map(i => [Row #i]))\n",
      );
      const rows = table?.rows ?? [];
      // Its strokes there start half their thickness above the top margin: they aren't the page header's.
      expect(rows.some((r) => r.pageBreak)).toBe(true);
      for (const row of rows)
        for (const cell of row.cells)
          expect(Object.keys(cell.borders).sort()).toEqual(["bottom", "left", "right", "top"]);
    });

    it("holds the room a cell's block left on a page when Typst moved the block on whole", () => {
      const [grid] = blocks(
        "#set page(height: 200pt)\n#v(110pt)\n#grid(columns: (1cm, 1fr), [5.], [Write about your weekend.\n  #block(breakable: false)[#for i in range(4) { block(above: 10pt, line(length: 100%)) }]])\n",
      );
      const cell = grid?.rows?.[0]?.cells[1]?.blocks ?? [];
      expect(cell.map((b) => b.type)).toEqual(["p", "drawing", "rule", "rule", "rule", "rule"]);
      expect(cell[1]).toMatchObject({ breakable: true });
      expect(cell[1]?.height).toBeGreaterThan(20);
    });

    it("makes a picture of a box stroked on its sides, anchored to its line where Typst lowered it", () => {
      const runs = blocks(
        `${PROFILE}#box(width: 0.8em, height: 0.8em, stroke: 0.5pt) Claim. #box(width: 0.9em, height: 0.9em, stroke: 0.6pt, baseline: 0.2em) Two.\n`,
      )[0]?.runs;
      const [first, second] = (runs ?? []).filter((r) => r.picture);
      // With its stroke's outer half; the second's top 8 pt above the baseline, 3.59 pt below the line's top.
      expect(first).toMatchObject({ gap: 9.3, picture: { y: -9.05 } });
      expect(first?.picture).not.toHaveProperty("line");
      expect(second).toMatchObject({ gap: 10.5, picture: { y: -8, line: 3.59 } });
    });

    it("measures a box's insets from the boxes in it, not their text", () => {
      const [outer] = blocks(
        "#rect(width: 7cm, inset: 0pt)[#rect(width: 100%, height: 1cm)[#align(center + horizon)[Upper]] #rect(width: 100%, height: 1cm)[#align(center + horizon)[Lower]]]\n",
      );
      const cell = outer?.rows?.[0]?.cells[0];
      expect(cell?.margins.left).toBe(0);
      expect(cell?.blocks.map((b) => b.indent)).toEqual([0, 0]);
    });

    it("gives columns filling the page the room above them in full", () => {
      const out = blocks(
        `${PROFILE}#set page(columns: 2)\n#place(top + center, scope: "parent", float: true)[Title]\n== A\nText.\n#colbreak()\n== B\nText.\n`,
      );
      // The float's clearance, 1.5em: not a point less, as for a block pushed to its page's bottom.
      expect(out.map((b) => [b.type, b.before])).toEqual([
        ["p", 0],
        ["columns", 16.5],
      ]);
    });
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
