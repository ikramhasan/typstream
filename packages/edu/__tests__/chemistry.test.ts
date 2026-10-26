// `ce()`: formulas and equations from plain text, as MathML in HTML.
import { describe, expect, it } from "vitest";
import { compileHtml, newEngine, problems } from "./support/engine";

const engine = newEngine();

/** The MathML `ce(formula)` compiles to, without whitespace. */
const mathml = (formula: string): string => {
  const out = compileHtml(engine, `#ce(${JSON.stringify(formula)})`);
  expect(problems(out.diagnostics)).toEqual([]);
  const m = /<math>([\s\S]*?)<\/math>/.exec(out.html);
  return (m?.[1] ?? "").replace(/>\s+</g, "><").trim();
};

describe("ce", () => {
  it.each([
    ["H2O", "<msub><mtext>H</mtext><mn>2</mn></msub><mtext>O</mtext>"],
    ["2H2O", "<mn>2</mn><msub><mtext>H</mtext><mn>2</mn></msub><mtext>O</mtext>"],
    ["NaCl", "<mtext>Na</mtext><mtext>Cl</mtext>"],
    ["Na+", "<msup><mtext>Na</mtext><mtext>+</mtext></msup>"],
    ["Cl-", "<msup><mtext>Cl</mtext><mtext>−</mtext></msup>"],
    ["SO4^2-", "<mtext>S</mtext><msubsup><mtext>O</mtext><mn>4</mn><mtext>2−</mtext></msubsup>"],
    ["Cu^{2+}", "<msup><mtext>Cu</mtext><mtext>2+</mtext></msup>"],
    ["NaCl(aq)", "<mtext>Na</mtext><mtext>Cl</mtext><mtext>(aq)</mtext>"],
  ])("%s", (formula, expected) => {
    expect(mathml(formula)).toBe(expected);
  });

  it("subscripts a group's count and keeps a hydrate's coefficient", () => {
    expect(mathml("Fe(OH)3")).toMatch(
      /^<mtext>Fe<\/mtext><msub><mrow><mtext>\(<\/mtext>.*<mtext>\)<\/mtext><\/mrow><mn>3<\/mn><\/msub>$/,
    );
    // The 5 after the dot is a coefficient, not a subscript of the dot.
    expect(mathml("CuSO4*5H2O")).toMatch(/<mo[^>]*>·<\/mo><mn>5<\/mn><msub><mtext>H<\/mtext>/);
  });

  it("writes equations with arrows and plus signs between species", () => {
    const eq = mathml("2H2 + O2 -> 2H2O");
    expect(eq).toContain("<mo>+</mo>");
    expect(eq).toMatch(/<mo[^>]*>⟶<\/mo>/);
    expect(mathml("A <=> B")).toMatch(/<mo[^>]*>⇌<\/mo>/);
  });
});
