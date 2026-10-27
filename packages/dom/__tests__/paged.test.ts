// The paged renderer's pure parts. The renderer itself is tested in browsers
// (__tests__/browser/paged.test.ts).

import type { TextRun } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { fitWidthInputs, isSafeHref } from "../src/paged";
import { layoutRuns } from "../src/paged/text-layer";

describe("isSafeHref", () => {
  it.each([
    "https://typst.app",
    "http://example.com/a?b#c",
    "HTTPS://EXAMPLE.COM",
    "mailto:teacher@example.com",
  ])("allows %s", (href) => expect(isSafeHref(href)).toBe(true));

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "/relative/path",
    "#anchor",
    "",
  ])("refuses %j", (href) => expect(isSafeHref(href)).toBe(false));
});

const run = (text: string, x: number, y: number, width: number, size = 11): TextRun => ({ text, x, y, size, width });

describe("layoutRuns", () => {
  it("breaks lines where the next run starts back to the left", () => {
    const laid = layoutRuns([run("first line of", 70, 100, 300), run("the paragraph", 70, 114, 200)]);
    expect(laid.map((r) => [r.text, r.br])).toEqual([
      ["first line of", true],
      ["the paragraph", false],
    ]);
  });

  it("adds a space across a gap on the same line, stretching the run over it", () => {
    // A heading: its number and its text are separate runs with a gap between.
    const laid = layoutRuns([run("1.1.", 70, 100, 20), run("Section 1", 100, 100, 50)]);
    expect(laid[0]).toMatchObject({ text: "1.1. ", width: 30, br: false });
    expect(laid[1]).toMatchObject({ text: "Section 1", width: 50 });
  });

  it("leaves runs that already have whitespace at the gap alone", () => {
    const laid = layoutRuns([run("a link", 70, 100, 25), run(" and ", 96, 100, 22)]);
    expect(laid.map((r) => r.text)).toEqual(["a link", " and "]);
  });

  it("keeps sub- and superscripts on the line", () => {
    // x^2 + 1: the 2 sits higher, to the right; math spacing before the + reads as a space.
    const laid = layoutRuns([run("x", 70, 100, 6), run("2", 76, 96, 4, 7.7), run("+ 1", 82, 100, 15)]);
    expect(laid.every((r) => !r.br)).toBe(true);
    expect(laid.map((r) => r.text).join("")).toBe("x2 + 1");
  });

  it("keeps the matrix of rotated text", () => {
    const laid = layoutRuns([{ ...run("Rotated", 73, 539, 64), matrix: [0.866, 0.5, -0.5, 0.866] }]);
    expect(laid[0]?.matrix).toEqual([0.866, 0.5, -0.5, 0.866]);
  });

  // Runs come in reading order: in right-to-left text the next one is to the left.
  // Positions from the Arabic corpus quiz (#63).
  it("spaces right-to-left runs across the gap on their left, stretching the run over it", () => {
    const laid = layoutRuns(
      [run("1", 533, 176.15, 5.58), run(".", 530.36, 176.15, 2.64), run("ما هو أقرب كوكب", 392.49, 176.15, 131.87)],
      "rtl",
    );
    expect(laid.map((r) => r.text)).toEqual(["1", ". ", "ما هو أقرب كوكب"]);
    expect(laid[1]?.x).toBeCloseTo(524.36);
    expect(laid[1]?.width).toBeCloseTo(8.64);
  });

  it("breaks right-to-left lines where the next run starts back at the right", () => {
    const laid = layoutRuns([run("سطر أول طويل", 300, 100, 238), run("ثان", 500, 114, 38)], "rtl");
    expect(laid.map((r) => r.br)).toEqual([true, false]);
    // A left-to-right run ending a line of an RTL document breaks it too.
    const mixed = layoutRuns([{ ...run("word", 56, 100, 30), dir: "ltr" }, run("ثان", 500, 114, 38)], "rtl");
    expect(mixed[0]?.br).toBe(true);
  });

  it("doesn't space runs with others between them on screen", () => {
    // `answers 1-ب، 2-ب، 3-أ. Jupiter`: an RTL stretch inside LTR text inside an RTL document.
    const runs: TextRun[] = [
      { ...run("answers 1-", 56.69, 664.97, 202.55, 9), dir: "ltr" },
      run("ب، ", 286.48, 664.97, 11.11, 9),
      run("2", 282.48, 664.97, 4, 9),
      run("-ب، ", 268.38, 664.97, 14.1, 9),
      run("3", 264.39, 664.97, 4, 9),
      run("-أ", 259.25, 664.97, 5.14, 9),
      { ...run(". Jupiter is 5th.", 297.59, 664.97, 52.67, 9), dir: "ltr" },
    ];
    const laid = layoutRuns(runs, "rtl");
    expect(laid.map((r) => r.text).join("")).toBe("answers 1-ب، 2-ب، 3-أ. Jupiter is 5th.");
    expect(laid.every((r) => !r.br)).toBe(true);
    // Their language and direction stay.
    expect(laid[0]?.dir).toBe("ltr");
  });
});

describe("fitWidthInputs", () => {
  it("converts CSS px to points, A4-proportioned by default", () => {
    expect(fitWidthInputs(800)).toEqual({ "typstream-page-width": "600", "typstream-page-height": "848.53" });
  });

  it("rounds to half a point and keeps the document's own inputs", () => {
    expect(fitWidthInputs(401, "auto", { lang: "en" })).toEqual({
      lang: "en",
      "typstream-page-width": "301",
      "typstream-page-height": "auto",
    });
  });
});
