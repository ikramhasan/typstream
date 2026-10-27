// The lines of `student-info` (a template's name, date and class) on paper: each sits just under its
// label, as a blank's line sits under the sentence it is in. The header is a grid with a label and
// its line in cells of their own; a line's cell holds no text, so aligned at the top it came out
// level with the middle of the label. Measured on the page: the labels' baselines from the text
// runs, the lines from the page SVG.
import { describe, expect, it } from "vitest";
import { compilePaged, newEngine, problems } from "./support/engine";

const engine = newEngine();

/**
 * The rules edu draws (stroke luma(120), as `#787878` fills), as the absolute y of their centre:
 * Typst writes each as a path in groups that translate it. Every group that opens counts, with or
 * without a translation, so each `</g>` closes the group it ends; an empty one (`<g …/>`) opens none.
 */
const rules = (svg: string): number[] => {
  const ys: number[] = [];
  const offsets: number[] = [0];
  const tokens = /<g\b([^>]*)>|<\/g>|<path fill="#787878"[^>]*d="M 0 0m [\d.]+ ([\d.]+)v ([\d.]+)/g;
  for (const m of svg.matchAll(tokens)) {
    const y = offsets[offsets.length - 1] as number;
    if (m[0] === "</g>") offsets.pop();
    else if (m[1] !== undefined) {
      if (m[1].endsWith("/")) continue;
      const t = /transform="(translate|matrix)\(([^)]*)\)"/.exec(m[1]);
      const n = t ? (t[2] as string).split(/[\s,]+/).map(Number) : [];
      offsets.push(y + ((t?.[1] === "translate" ? n[1] : n[5]) ?? 0));
    } else ys.push(y + Number(m[2]) + Number(m[3]) / 2);
  }
  return ys;
};

describe("student-info on paper", () => {
  for (const lang of ["en", "ar", "bn"]) {
    it(`puts each line under its label's baseline, as a blank's (${lang})`, () => {
      const source = `#set page(width: 12cm, height: auto, margin: 5mm)
#set text(lang: "${lang}")
#student-info()

Fill in: $5 times 4 =$ #blank()
`;
      const out = compilePaged(engine, source);
      expect(problems(out.diagnostics)).toEqual([]);
      const page = out.pages[0];
      if (!page) throw new Error("no page");
      const [name, date, cls, blank] = rules(page.svg);
      const label = page.text[0];
      const sentence = page.text.find((r) => r.text.startsWith("Fill"));
      if (!label || !sentence || blank === undefined) throw new Error("missing a label, the sentence or a line");
      // How far a blank's line falls below its sentence's baseline: the outset (0.25em) and half the stroke.
      const under = blank - sentence.y;
      expect(under).toBeGreaterThan(0);
      for (const line of [name, date, cls]) expect((line as number) - label.y).toBeCloseTo(under, 1);
    });
  }
});
