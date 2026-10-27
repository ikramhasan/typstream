#import "@preview/cetz:0.5.3"

#show: worksheet.with(
  title: [Photosynthesis: How Plants Make Food],
  subject: [Science],
  grade: [Grade 7],
  instructions: [Answer all questions. Use the word bank in Part A. Write neatly.],
)

#callout(kind: "remember")[
  Photosynthesis happens mainly in the leaves. Plants use light energy to turn carbon dioxide and water into glucose and oxygen.
]

= Part A: Fill in the blanks

*Word bank:* chlorophyll, sunlight, oxygen, glucose, carbon dioxide, stomata

#question(points: 1)[
  The green pigment that captures light energy is called #blank(answer: [chlorophyll]).
]

#question(points: 1)[
  Plants take in #blank(answer: [carbon dioxide]) from the air through tiny holes called #blank(answer: [stomata]).
]

#question(points: 1)[
  The energy for photosynthesis comes from #blank(answer: [sunlight]).
]

#question(points: 2)[
  The sugar made by photosynthesis is #blank(answer: [glucose]), and the gas released into the air is #blank(answer: [oxygen]).
]

#question(points: 2)[
  Complete the word equation:
  carbon dioxide + #blank(width: 4em, answer: [water]) #sym.arrow.r #blank(width: 4em, answer: [glucose]) + oxygen
]

= Part B: Multiple choice

#question(points: 1)[
  Which of these is needed for photosynthesis?
  #mcq([Oxygen], [Carbon dioxide], [Glucose], [Nitrogen], answer: 2)
]

#question(points: 1)[
  Which part of the plant absorbs water from the soil?
  #mcq([Leaves], [Flowers], [Roots], [Stomata], answer: 3)
]

#question(points: 1)[
  What is the chemical formula of the gas that plants release during photosynthesis?
  #mcq(ce("CO2"), ce("O2"), ce("H2O"), ce("N2"), answer: 2)
]

#question(points: 1)[
  What would happen to a plant kept in a dark cupboard for two weeks?
  #mcq(
    [It would make more glucose.],
    [It would make more oxygen.],
    [It would stop making glucose and become weak.],
    [Nothing would change.],
    answer: 3,
  )
]

= Part C: Label the diagram

#question(points: 4)[
  The diagram shows a cross-section of a leaf. Write the name of each labelled part on the lines below. Choose from: upper epidermis, palisade mesophyll, spongy mesophyll, stoma.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      // upper epidermis
      rect((0, 3.2), (8, 3.6), fill: rgb("#d9ead3"), stroke: 0.8pt)
      // palisade layer
      for i in range(0, 8) {
        rect((i + 0.1, 2.2), (i + 0.9, 3.2), fill: green.lighten(50%), stroke: 0.6pt)
      }
      // spongy layer
      for i in range(0, 7) {
        circle((i + 0.7, 1.6), radius: (0.4, 0.3), fill: green.lighten(75%), stroke: 0.6pt)
      }
      for i in range(0, 7) {
        circle((i + 1.1, 0.95), radius: (0.4, 0.3), fill: green.lighten(75%), stroke: 0.6pt)
      }
      // lower epidermis with a gap (stoma)
      rect((0, 0.2), (3.5, 0.6), fill: rgb("#d9ead3"), stroke: 0.8pt)
      rect((4.5, 0.2), (8, 0.6), fill: rgb("#d9ead3"), stroke: 0.8pt)
      circle((3.75, 0.4), radius: (0.25, 0.22), fill: green.darken(10%), stroke: 0.6pt)
      circle((4.25, 0.4), radius: (0.25, 0.22), fill: green.darken(10%), stroke: 0.6pt)

      // leader lines and letters
      circle((7.5, 3.4), radius: 0.05, fill: black)
      line((7.5, 3.4), (9, 3.4))
      content((9.4, 3.4), [*A*])

      circle((7.5, 2.7), radius: 0.05, fill: black)
      line((7.5, 2.7), (9, 2.7))
      content((9.4, 2.7), [*B*])

      circle((6.7, 1.6), radius: 0.05, fill: black)
      line((6.7, 1.6), (9, 1.6))
      content((9.4, 1.6), [*C*])

      line((4, 0.2), (4, -0.5))
      content((4, -0.85), [*D*])
    })
  ]

  #grid(
    columns: (auto, 1fr, auto, 1fr),
    column-gutter: 0.6em,
    row-gutter: 1.2em,
    [*A*], [#blank(width: 100%, answer: [upper epidermis])],
    [*B*], [#blank(width: 100%, answer: [palisade mesophyll])],
    [*C*], [#blank(width: 100%, answer: [spongy mesophyll])],
    [*D*], [#blank(width: 100%, answer: [stoma])],
  )
]

= Part D: Think about it

#question(points: 2)[
  Why do most photosynthesis cells in a leaf sit near the top surface, in the palisade layer?
  #answer-lines(count: 2, answer: [This layer is closest to the sunlight and contains many chloroplasts, so it can capture the most light energy.])
]

#answer-key()