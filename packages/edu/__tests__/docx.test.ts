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
});
