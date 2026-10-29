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
