// Test documents, from the Phase 0 smoke test (spikes/phase0/custom-engine/smoke.mjs).

/** One page of the constructs educational documents use: math, a figure with a table, refs, lists, raw. */
export const SMOKE = `#set page(paper: "a4")
#set heading(numbering: "1.")
= Introduction
This is *strong* text, _emphasis_, and inline math $a^2 + b^2 = c^2$.

$ integral_0^1 x^2 dif x = 1/3 $

== Data
#figure(
  table(columns: 3, [*A*], [*B*], [*C*], [1], [2], [3], [4], [5], [6]),
  caption: [A small table],
) <tab>

As shown in @tab, numbers increase. See also @sec-grid.

== Layout <sec-grid>
#grid(columns: 2, gutter: 1em, [Left cell with $sqrt(x)$], [Right cell])

\`inline raw\` and a list:
- one
- two

\`\`\`python
def hyphenation_example(x): return "Donaudampfschifffahrt" + str(x)
\`\`\`
#set text(lang: "de", hyphenate: true)
#block(width: 3cm)[Donaudampfschifffahrtsgesellschaftskapitän Rechtsschutzversicherungsgesellschaften]
`;

const section = (i: number): string => `
== Section ${i}: on the behaviour of series
Let $f(x) = sum_(k=0)^n a_k x^k$ be a polynomial of degree $n$ with *real* coefficients. We study
how the roots move as the coefficients $a_k$ vary, and give a short argument for
the bound $|z| <= 1 + max_k |a_k / a_n|$. The proof is elementary and uses only the triangle inequality.

$ |f(z)| >= |a_n| |z|^n - sum_(k<n) |a_k| |z|^k > 0 quad "for" |z| > R $

#table(columns: 4, [$k$], [$a_k$], [$|a_k|$], [note],
  [0], [$-1$], [1], [constant], [1], [$1/2$], [0.5], [linear], [2], [$pi$], [3.14], [quadratic])

Some more prose follows so that the section has realistic paragraph length. Students often confuse
the _degree_ of a polynomial with the number of distinct roots; the fundamental theorem of algebra
counts roots with multiplicity. #lorem(40)
`;

/** A six-page A4 document (13 sections), plus `extraParas` appended paragraphs. */
export const benchDoc = (extraParas = 0): string => {
  let s = `#set page(paper: "a4")\n#set heading(numbering: "1.")\n= A six page document\n`;
  for (let i = 1; i <= 13; i++) s += section(i);
  for (let j = 0; j < extraParas; j++) {
    s += `\nAppended paragraph ${j}: ${"streamed words go here and ".repeat(6)}done.\n`;
  }
  return s;
};

/**
 * 200 sources of a growing document, as when streaming: the tail gains a few
 * words per step and a new paragraph every 10 steps.
 */
export function* streamingSteps(steps = 200): Generator<string> {
  const base = benchDoc();
  let tail = "";
  for (let i = 1; i <= steps; i++) {
    tail += i % 10 === 0 ? `\n\nParagraph ${i}: ` : ` word${i} more text`;
    yield base + tail;
  }
}
