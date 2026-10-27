// The text runs each exported page carries (`ChangedPage.text`), for the paged
// renderer's selectable text layer (#14), and their structure, language and
// direction (#63).

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChangedPage, TextNode } from "../dist/engine.js";
import { Engine, newEngine } from "./support/engine.js";

const pagesOf = (source: string): ChangedPage[] => {
  const engine = newEngine();
  engine.set_source("/main.typ", source);
  const result = engine.compile_svg_changed();
  expect(result.ok).toBe(true);
  return result.changed ?? [];
};

const pageOf = (source: string) => pagesOf(source)[0] as ChangedPage;

/** A page's structure with each node's runs (joined with `|`) instead of their indices. */
type Shape = [role: string, text: string, children?: Shape[]] | [role: string, level: number, text: string];
const shape = (page: ChangedPage, nodes: TextNode[] = page.structure): Shape[] =>
  nodes.map((n) => {
    const text = page.text
      .slice(n.from, n.to)
      .map((r) => r.text)
      .join("|");
    if (n.level !== undefined) return [n.role, n.level, text];
    return n.children ? [n.role, text, shape(page, n.children)] : [n.role, text];
  });

const dist = new URL("../dist/", import.meta.url);
const corpus = new URL("../../../corpus/edu/", import.meta.url);
/** An engine with the script fonts too (Arabic, Bengali, Devanagari), and the corpus's assets. */
const scriptEngine = () => {
  const engine = newEngine();
  for (const f of readdirSync(new URL("fonts/", dist))) {
    if (f.startsWith("Noto")) Engine.add_font(readFileSync(new URL(`fonts/${f}`, dist)));
  }
  for (const f of readdirSync(new URL("assets/", corpus))) {
    engine.set_file(`/assets/${f}`, readFileSync(new URL(`assets/${f}`, corpus)));
  }
  return engine;
};
const corpusPages = (engine: InstanceType<typeof Engine>, name: string): ChangedPage[] => {
  engine.set_source("/main.typ", readFileSync(new URL(`${name}.typ`, corpus), "utf8"));
  engine.reset_pages();
  const result = engine.compile_svg_changed();
  expect(result.ok).toBe(true);
  return result.changed ?? [];
};

describe("text runs", () => {
  it("lists the page's text in document order, with baseline positions in points", () => {
    const page = pageOf(
      `#set page(width: 300pt, height: 200pt, margin: 20pt)\n= Title\nFirst line.\n\nSecond paragraph.`,
    );
    expect(page.text.map((r) => r.text)).toEqual(["Title", "First line.", "Second paragraph."]);
    const [title, first, second] = page.text;
    // Left margin, baselines going down the page; body text at the default 11pt.
    expect(title?.x).toBeCloseTo(20, 1);
    expect(first?.size).toBe(11);
    expect(title?.y).toBeLessThan(first?.y as number);
    expect(first?.y).toBeLessThan(second?.y as number);
    for (const run of page.text) {
      expect(run.width).toBeGreaterThan(0);
      expect(run.x + run.width).toBeLessThanOrEqual(280);
      expect(run.matrix).toBeUndefined();
    }
  });

  it("includes text in math, tables and nested layout, and nothing for blank runs", () => {
    const page = pageOf(`$x^2 + 1$ #table(columns: 2, [a], [b]) #box(pad(left: 1em)[inner])`);
    const text = page.text.map((r) => r.text).join("|");
    for (const part of ["𝑥", "2", "+", "1", "a", "b", "inner"]) expect(text).toContain(part);
    expect(page.text.every((r) => r.text.trim() !== "")).toBe(true);
    // The superscript is smaller and sits higher than the base.
    const x = page.text.find((r) => r.text === "𝑥");
    const two = page.text.find((r) => r.text === "2");
    expect(two?.size).toBeLessThan(x?.size as number);
    expect(two?.y).toBeLessThan(x?.y as number);
  });

  it("gives rotated and scaled text its linear transform", () => {
    const page = pageOf(`#rotate(90deg)[Turned] #scale(x: 200%)[Wide]`);
    const turned = page.text.find((r) => r.text === "Turned");
    const wide = page.text.find((r) => r.text === "Wide");
    expect(turned?.matrix?.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, -1, 0]);
    expect(wide?.matrix).toEqual([2, 0, 0, 1]);
  });

  it("is empty for a page without text", () => {
    expect(pageOf(`#rect(width: 2cm)`).text).toEqual([]);
  });
});

describe("language and direction", () => {
  it("gives each page the document's language and direction, and runs theirs where they differ", () => {
    const engine = scriptEngine();
    // Typst takes the document's language from the first text style at the top level.
    engine.set_source("/main.typ", `#set text(lang: "en")\nHello #text(lang: "de")[Haus] and مرحبا بالعالم.`);
    const page = engine.compile_svg_changed().changed?.[0] as ChangedPage;
    expect([page.lang, page.dir]).toEqual(["en", "ltr"]);
    expect(page.text.find((r) => r.text.includes("Hello"))).not.toHaveProperty("lang");
    expect(page.text.find((r) => r.text.includes("Haus"))?.lang).toBe("de");
    // Shaped right to left, its clusters run backwards; read in logical order.
    expect(page.text.find((r) => r.dir === "rtl")?.text).toBe("مرحبا بالعالم");
    expect(pageOf(`#set text(lang: "zh", region: "CN")\n文字`).lang).toBe("zh-CN");
    expect(pageOf(`#set text(lang: "he")\nשלום`).dir).toBe("rtl");
  });

  // Noto Naskh Arabic draws dots as mark glyphs with a vertical offset, and
  // Typst makes an item of every stretch of glyphs with one offset and font
  // (spaces come from Libertinus): a word was pieces in visual order, each mark
  // repeating its letter.
  it("reads Arabic in logical order, whole, without repeated letters", () => {
    const engine = scriptEngine();
    const [page] = corpusPages(engine, "multilingual-arabic-rtl-quiz") as [ChangedPage];
    expect([page.lang, page.dir]).toEqual(["ar", "rtl"]);
    const texts = page.text.map((r) => r.text);
    expect(texts[0]).toBe("اختبار قصير: الجهاز الشمسي");
    expect(texts).toContain("ما هو أقرب كوكب إلى الشمس؟");
    // The marker is its own run, before its question.
    expect(texts.join("|")).toContain("1|.|ما هو أقرب كوكب إلى الشمس؟");
    expect(texts.join("")).toContain(
      "لماذا تبدو الشمس أكبر من النجوم الأخرى في السماء؟ يمكنك استخدام كلمة distance (المسافة) في إجابتك.",
    );
    // English inside the Arabic document is marked as set left to right; the Arabic isn't.
    expect(page.text.find((r) => r.text === "distance")?.dir).toBe("ltr");
    expect(page.text.filter((r) => r.dir === "rtl")).toEqual([]);
    // Every Arabic letter of the source once.
    const arabic = (s: string) => s.match(/\p{Script=Arabic}/gu)?.length ?? 0;
    const source = readFileSync(new URL("multilingual-arabic-rtl-quiz.typ", corpus), "utf8");
    expect(arabic(texts.join(""))).toBe(arabic(source));
  });

  it("keeps marks of Indic scripts once", () => {
    const engine = scriptEngine();
    // Letters and marks: list numbers in the script's digits are Typst's.
    for (const [name, script] of [
      ["multilingual-bengali-math", /(?!\p{N})\p{Script=Bengali}/gu],
      ["multilingual-hindi-science", /(?!\p{N})\p{Script=Devanagari}/gu],
    ] as const) {
      const text = corpusPages(engine, name)
        .flatMap((p) => p.text.map((r) => r.text))
        .join("");
      const source = readFileSync(new URL(`${name}.typ`, corpus), "utf8");
      expect(text.match(script)?.length, name).toBe(source.match(script)?.length);
    }
  });
});

describe("structure", () => {
  it("finds headings, lists and tables, with header cells and empty ones", () => {
    const page = pageOf(`#set page(width: 300pt, height: auto)
#title[Doc]
= Intro
#set heading(numbering: "1.1")
== Sub
- a
- b
  + nested
/ Term: def
#table(columns: 2, table.header([H1], [H2]), [x], [], [y], [z])
#grid(columns: 2, [g1], [g2])
#table(columns: 2, row-gutter: 4pt, [A], [B], table.header([C], [D]), [1], [2])`);
    expect(shape(page)).toEqual([
      // The title is h1 and a level-n heading n + 1, as in typst-html.
      ["heading", 1, "Doc"],
      ["heading", 2, "Intro"],
      ["heading", 3, "0.1|Sub"],
      [
        "list",
        "•|a|•|b|1.|nested",
        [
          ["listitem", "•|a"],
          ["listitem", "•|b|1.|nested", [["list", "1.|nested", [["listitem", "1.|nested"]]]]],
        ],
      ],
      ["list", "Term|def", [["listitem", "Term|def"]]],
      [
        "table",
        "H1|H2|x|y|z",
        [
          [
            "row",
            "H1|H2",
            [
              ["columnheader", "H1"],
              ["columnheader", "H2"],
            ],
          ],
          [
            "row",
            "x",
            [
              ["cell", "x"],
              ["cell", ""],
            ],
          ],
          [
            "row",
            "y|z",
            [
              ["cell", "y"],
              ["cell", "z"],
            ],
          ],
        ],
      ],
      // A grid is layout: its cells are in the text, without structure.
      [
        "table",
        "A|B|C|D|1|2",
        [
          [
            "row",
            "A|B",
            [
              ["cell", "A"],
              ["cell", "B"],
            ],
          ],
          // A header after the first row, with gutters between rows.
          [
            "row",
            "C|D",
            [
              ["columnheader", "C"],
              ["columnheader", "D"],
            ],
          ],
          [
            "row",
            "1|2",
            [
              ["cell", "1"],
              ["cell", "2"],
            ],
          ],
        ],
      ],
    ]);
    expect(page.text.map((r) => r.text)).toContain("g1");
  });

  it("carries lists and tables on across pages", () => {
    const list = pagesOf(`#set page(width: 200pt, height: 120pt)\n#list([#lorem(40)], [second])`);
    expect(list).toHaveLength(2);
    // The first item goes on at the top of page 2.
    const [continued, second] = (list[1] as ChangedPage).structure[0]?.children ?? [];
    expect(continued).toMatchObject({ role: "listitem", from: 0 });
    expect(second).toMatchObject({ role: "listitem" });

    // Page 2 of 3 has none of the table's tags: it starts on page 1 and ends on page 3.
    const table = pagesOf(`#set page(width: 200pt, height: 120pt)
#table(columns: 1, table.header([H]), ..range(9).map(i => [r#i]))`);
    expect(table).toHaveLength(3);
    for (const page of table) {
      const [header, ...rows] = shape(page) as [["table", string, Shape[]]];
      expect(header[0]).toBe("table");
      // The header repeats on every page.
      expect(header[2][0]).toEqual(["row", "H", [["columnheader", "H"]]]);
      expect(rows).toEqual([]);
    }
  });

  it("drops headings without text", () => {
    expect(pageOf(`= #box(width: 1cm, height: 1cm, fill: red)\nText`).structure).toEqual([]);
  });

  // typst-html writes a level-n heading as <h{n+1}> (and #title as <h1>): the
  // paged layer's headings must be the HTML export's.
  it("has the headings of the HTML export, over the edu corpus", () => {
    const engine = scriptEngine();
    const letters = (s: string) => (s.normalize("NFKC").match(/[\p{L}\p{N}]/gu) ?? []).join("");
    const names = readdirSync(corpus)
      .filter((f) => f.endsWith(".typ"))
      .map((f) => f.slice(0, -4));
    expect(names.length).toBeGreaterThan(30);
    for (const name of names) {
      const paged: string[] = [];
      for (const page of corpusPages(engine, name)) {
        const walk = (nodes: TextNode[] = []) => {
          for (const n of nodes) {
            if (n.role === "heading") {
              const text = page.text.slice(n.from, n.to).map((r) => r.text);
              paged.push(`${n.level} ${letters(text.join(""))}`);
            }
            walk(n.children);
          }
        };
        walk(page.structure);
      }
      const html = engine.compile_html().html ?? "";
      const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
        (m) => `${m[1]} ${letters((m[2] as string).replace(/<[^>]+>/g, ""))}`,
      );
      // A show rule that replaces the heading leaves typst-html without its <h2>; its tag still marks it.
      if (name === "exam-algebra-final") expect(headings).toEqual([]);
      else expect(paged, name).toEqual(headings);
    }
  });
});
