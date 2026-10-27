#show: worksheet.with(
  title: [Photosynthesis],
  subject: [Science],
  grade: [Grade 7],
  info: ("name", "date", "class"),
  instructions: [Answer every question. Use the word bank for the fill-in-the-blank questions.],
)

#import "@preview/cetz:0.5.3"

#callout(kind: "remember")[
  Photosynthesis is the process by which green plants use light energy to make glucose from carbon dioxide and water.
]

= Part A: Fill in the blanks

#question(points: 2)[
  Complete the sentences using words from this list: _chlorophyll, oxygen, stomata, glucose, roots_.
  + Plants absorb light using a green pigment called #blank(width: 6em, answer: [chlorophyll]).
  + Plants release #blank(width: 6em, answer: [oxygen]) as a waste product.
  + Carbon dioxide enters the leaf through tiny pores called #blank(width: 6em, answer: [stomata]).
  + The sugar produced by photosynthesis is #blank(width: 6em, answer: [glucose]).
]

#question(points: 2)[
  The word equation for photosynthesis is:

  #align(center)[carbon dioxide + water #sym.arrow.r glucose + oxygen]

  Write the balanced chemical equation: #ce("6CO2 + 6H2O -> C6H12O6 + 6O2")
  #answer-lines(count: 1, answer: ce("6CO2 + 6H2O -> C6H12O6 + 6O2"))
]

= Part B: Multiple choice

#question(points: 1)[
  Which gas do plants take in from the air for photosynthesis?
  #mcq([Oxygen], [Nitrogen], [Carbon dioxide], [Hydrogen], answer: 3)
]

#question(points: 1)[
  Where in a plant cell does photosynthesis take place?
  #mcq([Nucleus], [Chloroplast], [Mitochondrion], [Cell wall], answer: 2)
]

#question(points: 1)[
  A plant is placed in a dark cupboard for three days. What happens to its rate of photosynthesis?
  #mcq([It increases], [It stays the same], [It stops], [It doubles], answer: 3)
]

= Part C: Label the leaf

#question(points: 4)[
  The diagram shows a cross-section of a leaf with four parts marked 1 to 4. Write the name of each part in the blank beside it.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      rect((-3.6, -2.2), (3.6, 2.2), stroke: none)
      ellipse((0, 0), (3, 1.5), stroke: 1.2pt + rgb("#2e7d32"), fill: rgb("#c8e6c9"))
      line((-2.8, 0), (2.8, 0), stroke: 0.8pt + rgb("#1b5e20"))
      line((-3, 0), (-3.9, 0), stroke: 1.5pt + rgb("#2e7d32"))
      content((1.6, 1.1), text(size: 9pt)[1], frame: "circle", padding: 0.12)
      content((-0.8, 0.5), text(size: 9pt)[2], frame: "circle", padding: 0.12)
      content((0.9, -0.3), text(size: 9pt)[3], frame: "circle", padding: 0.12)
      content((1.6, -1.1), text(size: 9pt)[4], frame: "circle", padding: 0.12)
    })
  ]

  + Part 1: #blank(width: 10em, answer: [upper epidermis])
  + Part 2: #blank(width: 10em, answer: [palisade mesophyll])
  + Part 3: #blank(width: 10em, answer: [vein (xylem and phloem)])
  + Part 4: #blank(width: 10em, answer: [stoma (guard cells)])
]

#question(points: 3)[
  Explain why the palisade layer is packed with chloroplasts.
  #answer-lines(count: 3, answer: [The palisade layer is near the upper surface, where most light arrives, so it holds many chloroplasts to absorb as much light as possible.])
]

#answer-key()