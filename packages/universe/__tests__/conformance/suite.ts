// Universe's conformance suite (#135): a few documents using each allowed package, as a model writes them (#24), must
// look the same in the paged view, Typst's PDF and the DOCX export. CeTZ's, cetz-plot's, fletcher's and alchemist's
// drawings are pictures in the DOCX (#133); physica's, unify's and chemformula's output is Word math (#132) or text.
import type { ConformanceSuite } from "@typstream/conformance";
import { universe } from "../../src/index";

const DIAGRAMS = `#import "@preview/cetz:0.5.3"
#import "@preview/fletcher:0.5.8": diagram, edge, node

= Shapes and flows

A right triangle with its sides labelled:

#cetz.canvas({
  import cetz.draw: *
  line((0, 0), (4, 0), (4, 3), close: true)
  rect((3.6, 0), (4, 0.4))
  content((2, -0.4), [4 cm])
  content((4.6, 1.5), [3 cm])
  content((1.6, 1.9), [5 cm])
})

The water cycle as a flowchart:

#diagram(
  node-stroke: 0.6pt,
  spacing: 2.4em,
  node((0, 0), [Evaporation]),
  edge("-|>"),
  node((1, 0), [Condensation]),
  edge("-|>"),
  node((2, 0), [Precipitation]),
  edge((2, 0), (0, 0), "-|>", bend: 40deg, [Collection]),
)
`;

const PLOT = `#import "@preview/cetz:0.5.3"
#import "@preview/cetz-plot:0.1.4": plot

= Graphs of functions

The graph of $y = x^2 - 2$ for $-2 <= x <= 2$:

#cetz.canvas(plot.plot(size: (6, 4), x-label: $x$, y-label: $y$, {
  plot.add(domain: (-2, 2), x => x * x - 2)
}))

Where does the graph cross the $x$-axis?
`;

const PHYSICS = `#import "@preview/physica:0.9.8": *
#import "@preview/unify:0.8.1": num, qty, unit

= Motion

A ball falls with an acceleration of #qty("9.81", "m/s^2"). Its velocity is the derivative of its position,
$v = dv(x, t)$, and its acceleration that of its velocity:

$ a = dv(v, t) = dv(x, t, 2) $

The force on it is $vb(F) = m vb(a)$. A mole holds #num("6.022e23") particles; force is measured in
#unit("kg m s^-2").
`;

const CHEMISTRY = `#import "@preview/chemformula:0.1.3": ch
#import "@preview/alchemist:0.2.0": *

= Reactions

Hydrogen burns in oxygen: #ch("2H2 + O2 -> 2H2O"). Copper sulfate crystals hold water: #ch("CuSO4*5H2O").

Ethanol:

#skeletize({
  fragment("H_3C")
  single()
  fragment("CH_2")
  single()
  fragment("OH")
})
`;

export const suite: ConformanceSuite = {
  name: "universe",
  plugins: [universe],
  examples: [
    { name: "diagrams (CeTZ, fletcher)", source: DIAGRAMS },
    { name: "plot (cetz-plot)", source: PLOT },
    { name: "physics (physica, unify)", source: PHYSICS },
    { name: "chemistry (chemformula, alchemist)", source: CHEMISTRY },
  ],
};
