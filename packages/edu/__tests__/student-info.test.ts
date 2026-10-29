// The lines of `student-info` (a template's name, date and class) on paper: each sits under its label, at the bottom
// of the label's line (where a DOCX export draws it, as a paragraph's bottom border, #135). The header is a grid with
// a label and its line in cells of their own; a line's cell holds no text, so aligned at the top it came out level
// with the middle of the label. Measured on the page: the labels' baselines from the text runs, the lines from the
// page SVG.
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
  const tokens = /<g\b([^>]*)>|<\/g>|<path fill="#787878"[^>]*d="M 0 0m [\d.]+ (-?[\d.]+)v (-?[\d.]+)/g;
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
    it(`puts each line at the bottom of its label's line (${lang})`, () => {
      const source = `#set page(width: 12cm, height: auto, margin: 5mm)
#set text(lang: "${lang}")
#student-info()
`;
      const out = compilePaged(engine, source);
      expect(problems(out.diagnostics)).toEqual([]);
      const page = out.pages[0];
      if (!page) throw new Error("no page");
      const [name, date, cls] = rules(page.svg);
      const label = page.text[0];
      if (!label || cls === undefined) throw new Error("missing a label or a line");
      // Compiled without the engine's layout profile, a line box ends at the baseline (with it, 0.246em below, as
      // Word's exact line spacing does, #129).
      for (const line of [name, date, cls]) expect((line as number) - label.y).toBeCloseTo(0, 1);
    });
  }
});
