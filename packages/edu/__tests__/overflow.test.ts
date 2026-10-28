// Words stay inside their cells. Typst breaks a line only at a space unless it may hyphenate, and
// hyphenation is off (the engine's layout profile, #129), so on paper a word wider than its column runs
// into the next one instead of wrapping. Overflow isn't an error, so a probe looks for it: every word in a table
// or grid is measured against the width its cell gives it, and the document ends in a panic that
// names the words that don't fit (unless their text may hyphenate). tools/llm-corpus's measure
// uses the same probe on model output.
import { describe, expect, it } from "vitest";
import { compilePaged, newEngine, pagedText, problems } from "./support/engine";

const engine = newEngine();

const PROBE = `#let _overflow = state("overflow-probe", ())
#let _probe(it) = {
  show regex("[\\p{L}\\p{M}\\p{N}]+"): w => box(layout(size => {
    if text.hyphenate != true and measure(w).width > size.width + 0.01pt { _overflow.update(o => o + (w.text,)) }
    w
  }))
  it
}
#show table: _probe
#show grid: _probe
`;
const PROBE_END = `
#context { let o = _overflow.final(); if o.len() > 0 { panic("overflow: " + o.join(", ")) } }
`;

/** The words that run out of their cells, from the probe's panic. */
const overflowing = (source: string): string[] => {
  const out = compilePaged(engine, PROBE + source + PROBE_END);
  const panic = out.diagnostics.find((d) => d.message.startsWith("panicked with: overflow: "));
  const rest = problems(out.diagnostics.filter((d) => d !== panic));
  if (rest.length) throw new Error(rest.join("\n"));
  return panic ? panic.message.slice("panicked with: overflow: ".length).split(", ") : [];
};

const ESSAY = `#rubric(
  ([Counterargument], [Fairly presents and comprehensively rebuts opposing views.], [Acknowledges them.], [Mentions them.], [Ignores them.]),
  ([Organization], [Logical structure.], [Generally logical.], [Inconsistent.], [None.]),
  levels: ("Exemplary", "Proficient", "Developing", "Beginning", "Incomplete"),
)`;

describe("words stay inside their cells", () => {
  it("the probe finds a word wider than its column", () => {
    expect(overflowing("#table(columns: (1.5cm, 1fr), [Counterargument], [fits])")).toEqual(["Counterargument"]);
    expect(overflowing("#table(columns: (4cm, 1fr), [Counterargument], [fits])")).toEqual([]);
  });

  it("rubric: a cell with a word wider than its column is set smaller (#130)", () => {
    expect(overflowing(ESSAY)).toEqual([]);
    expect(overflowing(`#set page(flipped: true)\n${ESSAY}`)).toEqual([]);
  });

  it("rubric: words stay whole, as Word would break one mid-word", () => {
    // No hyphenation, which Word does its own way: the word is whole, in smaller text.
    const text = pagedText(compilePaged(engine, ESSAY));
    expect(text).toContain("Counterargument");
    for (const word of ["structure.", "logical.", "Inconsistent.", "Acknowledges"]) expect(text).toContain(word);
  });
});
