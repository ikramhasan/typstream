// DOCX exports of edu's documents (#133): Word draws every component itself but the drawings (number line, graph
// paper, coordinate plane), which are pictures with their descriptions. Nothing else falls back to a picture: no
// `docx/fallback` warning, and every picture is a drawing's.
import { describe, expect, it } from "vitest";
import { eduCatalogue, eduExamples, eduTemplates } from "../src/index";
import { compileDocx, newEngine } from "./support/engine";

const engine = newEngine();

/** A body for template examples, so they have questions and points to count. */
const BODY = "\n= Part A\n\n#question(points: 2)[What is $2 + 2$? #blank(answer: [4])]\n";

const documents: [string, string][] = [
  ...eduCatalogue.map((d): [string, string] => [
    `catalogue: ${d.name}`,
    (d.example ?? "") + (d.example?.startsWith("#show:") ? BODY : ""),
  ]),
  ...eduTemplates.map((t): [string, string] => [`template spec: ${t.name}`, t.preamble + BODY]),
  ...eduExamples.map((e): [string, string] => [`example: ${e.title}`, e.output]),
];

describe("DOCX exports", () => {
  it.each(documents)("%s: Word draws all but drawings, pictures with their descriptions", (_, source) => {
    for (const answers of [false, true]) {
      const { model, diagnostics } = compileDocx(engine, source, { answers });
      expect(model).not.toBeNull();
      expect(diagnostics.filter((d) => d.code === "docx/fallback")).toEqual([]);
      for (const picture of model?.pictures ?? []) expect(picture.alt).toBeTruthy();
    }
  });

  it("gives each drawing its description", () => {
    const { model } = compileDocx(
      engine,
      "#number-line(from: 0, to: 10)\n#graph-paper(cols: 4, rows: 2)\n#coordinate-plane()\n",
    );
    expect(model?.pictures?.map((p) => p.alt)).toEqual([
      expect.stringContaining("Number line"),
      "Graph paper, 4 by 2 squares",
      expect.stringContaining("oordinate"),
    ]);
  });

  // A student types on a line: an empty one is a rule with a line to type on above it (the room its box has),
  // a filled-in one the value in a cell with a bottom border; a blank is underlined room in its line.
  it("writes lines to type on: a student's details, a matching letter, answer lines", () => {
    type Block = {
      type: string;
      writable?: number;
      rows?: { cells: { blocks: Block[] }[] }[];
      runs?: { text?: string }[];
    };
    const rules = (blocks: Block[]): Block[] =>
      blocks.flatMap((b) => [
        ...(b.type === "rule" ? [b] : []),
        ...(b.rows ?? []).flatMap((r) => r.cells.flatMap((c) => rules(c.blocks))),
      ]);
    // The engine's layout profile (packages/engine's LAYOUT_PROFILE) makes a line box the line's pitch.
    const profile =
      "#show text: set text(top-edge: 1.054em, bottom-edge: -0.246em)\n#show par: set par(leading: 0pt, justify: false)\n";
    const { model } = compileDocx(
      engine,
      `${profile}#student-info(name: [Ikram Hasan], date: none)
#question[Match. #matching(([a], [A]), ([b], [B]))]
#question[Explain. #answer-lines(count: 2)]
`,
    );
    const sections = (model as { sections?: { blocks: Block[] }[] } | null)?.sections;
    const lines = rules(sections?.[0]?.blocks ?? []);
    // The date, two matching letters, two answer lines: every one a line to type on, as tall as its text's line
    // (14.3 pt at 11 pt, less the stroke) or its spacing (2em).
    expect(lines.map((r) => r.writable)).toEqual([13.8, 13.8, 13.8, 21.6, 21.6]);
    expect(JSON.stringify(model)).toContain("Ikram Hasan");
  });
});
