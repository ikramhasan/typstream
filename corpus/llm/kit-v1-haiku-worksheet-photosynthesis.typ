#show: worksheet.with(
  title: [Photosynthesis],
  subject: [Science],
  grade: [Grade 7],
  info: ("name", "date", "class"),
  instructions: [Read each question carefully. Write your answers in the spaces provided.],
)

#callout(kind: "remember")[
  Photosynthesis is the process by which green plants use light energy to make glucose from carbon dioxide and water. Oxygen is released as a by-product.
]

= Part A: Fill in the blanks

#question(points: 2)[
  Complete the sentences using the words in the box: _chlorophyll_, _stomata_, _glucose_, _roots_.
  + Green plants absorb light using a pigment called #blank(width: 6em, answer: [chlorophyll]).
  + Carbon dioxide enters the leaf through tiny pores called #blank(width: 6em, answer: [stomata]).
  + The plant uses light energy to make #blank(width: 6em, answer: [glucose]) as food.
  + Water is absorbed from the soil through the #blank(width: 5em, answer: [roots]).
]

= Part B: Multiple choice

#question(points: 1)[
  Which gas do plants take in for photosynthesis?
  #mcq([Oxygen], [Nitrogen], [Carbon dioxide], [Hydrogen], answer: 3)
]

#question(points: 1)[
  Where does most photosynthesis take place in a plant?
  #mcq([In the roots], [In the stem], [In the leaves], [In the flowers], answer: 3)
]

#question(points: 1)[
  Which condition is needed for photosynthesis?
  #mcq([Darkness], [Light], [Cold temperatures], [Salt water], answer: 2)
]

#question(points: 1)[
  Which gas is released during photosynthesis?
  #mcq([Carbon dioxide], [Oxygen], [Nitrogen], [Methane], answer: 2)
]

= Part C: Label the leaf

#question(points: 4)[
  The diagram shows a cross-section of a leaf. Label the parts A to D by writing the correct name for each letter.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      // leaf blade
      circle((0, 0), radius: (3.2, 1.6), stroke: 1pt + green.darken(20%), fill: green.lighten(75%))
      // midrib
      line((-3, 0), (3, 0), stroke: 0.8pt + green.darken(30%))
      // stem
      line((-3, 0), (-4.8, -1.4), stroke: 3pt + green.darken(30%))
      // label leader lines and letters
      line((0.5, 0.2), (2.2, 1.9), stroke: 0.5pt)
      content((2.5, 2.1), [A])
      line((-0.5, -0.2), (-1.8, -1.9), stroke: 0.5pt)
      content((-2.0, -2.2), [B])
      line((1.2, 0.0), (2.4, -1.9), stroke: 0.5pt)
      content((2.6, -2.2), [C])
      line((-4.0, -0.7), (-5.6, 0.9), stroke: 0.5pt)
      content((-5.9, 1.1), [D])
    })
  ]

  + A: #blank(width: 8em, answer: [upper epidermis])
  + B: #blank(width: 8em, answer: [palisade layer])
  + C: #blank(width: 8em, answer: [vein (xylem and phloem)])
  + D: #blank(width: 8em, answer: [petiole (leaf stalk)])

  #answer[Other acceptable answers include "stomata" for a pore on the lower surface, and "spongy mesophyll" for the layer below the palisade. Accept reasonable equivalent names.]
]

= Part D: Short answer

#question(points: 3)[
  Write the word equation for photosynthesis, then write the balanced chemical equation.
  #answer-lines(count: 3, answer: [Word equation: carbon dioxide + water #sym.arrow glucose + oxygen. Balanced: #ce("6CO2 + 6H2O -> C6H12O6 + 6O2")])
]

#question(points: 2)[
  Explain why a plant kept in a dark cupboard for several days would eventually die, even if it has enough water.
  #answer-lines(count: 2, answer: [Without light, the plant cannot carry out photosynthesis, so it cannot make glucose for energy and growth.])
]

#answer-key()