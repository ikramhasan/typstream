// Test documents for the engine bake-off. A "worksheet" section is roughly a
// third of an A4 page; SECTIONS_FOR_PAGES is calibrated against native typst
// (see calibrate.mjs).

export const HEADER = `#set page(paper: "a4", margin: 2cm)
#set text(font: "Libertinus Serif", size: 11pt)
#set heading(numbering: "1.")
#set math.equation(numbering: "(1)")

`;

export const section = (i) => `= Topic ${i}: Linear equations

#lorem(60)

*Example ${i}.* Solve $3x + ${i} = 2x - 5$ for $x$.

$ x = -5 - ${i} $

+ Simplify $(x^2 - 1)/(x - 1)$ for $x != 1$.
+ Find $sum_(k=1)^n k$ for $n = ${i + 3}$.
+ Explain in one sentence why _division by zero_ is undefined.

#figure(
  table(columns: 3, stroke: 0.5pt, [*x*], [*y*], [*x + y*], [1], [${i}], [${i + 1}], [2], [${2 * i}], [${2 * i + 2}]),
  caption: [Values for exercise ${i}],
) <tab${i}>

As shown in @tab${i}, the sum grows linearly with $x$.

`;

export const SECTIONS_FOR_PAGES = { 1: 2, 5: 11, 20: 49 };

export const makeDoc = (sections) =>
  HEADER + Array.from({ length: sections }, (_, i) => section(i + 1)).join("");

// Streaming prefixes cut at blank lines: each one is what the healer would
// hand to the compiler after a block completes. At most `maxSteps`, evenly
// spaced, always ending with the full document.
export const streamSteps = (doc, maxSteps = 40) => {
  const cuts = [];
  let i = doc.indexOf("\n\n", HEADER.length);
  while (i !== -1) {
    cuts.push(i + 2);
    i = doc.indexOf("\n\n", i + 2);
  }
  if (cuts.at(-1) !== doc.length) cuts.push(doc.length);
  if (cuts.length <= maxSteps) return cuts.map((c) => doc.slice(0, c));
  const out = [];
  for (let k = 1; k <= maxSteps; k++) {
    out.push(doc.slice(0, cuts[Math.round((k * cuts.length) / maxSteps) - 1]));
  }
  return out;
};
