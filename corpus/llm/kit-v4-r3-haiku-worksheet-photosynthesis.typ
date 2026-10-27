#show: worksheet.with(title: [Photosynthesis], subject: [Science], grade: [Grade 7], info: ("name", "class", "date"))
#import "@preview/cetz:0.5.3"

#instructions[
  Answer all questions. For the diagram, write the name of each labelled part.
]

#question(points: 4)[
  Complete the sentences. Use the words in the box: _light_, _oxygen_, _chlorophyll_, _carbon dioxide_, _glucose_.

  + Plants use #blank(width: 6em, answer: [light]) energy to make food.
  + The green pigment that absorbs light is called #blank(width: 7em, answer: [chlorophyll]).
  + Plants take in #blank(width: 7em, answer: [carbon dioxide]) from the air through their leaves.
  + The sugar that plants make is called #blank(width: 6em, answer: [glucose]), and the gas they release is #blank(width: 5em, answer: [oxygen]).
]

#question(points: 2)[
  The word equation for photosynthesis is:

  #align(center)[carbon dioxide + water #sym.arrow.r glucose + oxygen]

  Write the balanced chemical equation for photosynthesis.
  #answer-lines(count: 1, answer: ce("6CO2 + 6H2O -> C6H12O6 + 6O2"))
]

#question(points: 1)[
  Which gas do plants take in during photosynthesis?
  #mcq([Oxygen], [Nitrogen], [Carbon dioxide], [Hydrogen], answer: 3)
]

#question(points: 1)[
  Where in a plant cell does photosynthesis take place?
  #mcq([Nucleus], [Chloroplast], [Cell wall], [Vacuole], answer: 2)
]

#question(points: 1)[
  Which condition is _not_ needed for photosynthesis?
  #mcq([Light], [Water], [Carbon dioxide], [Darkness], answer: 4)
]

#question(points: 4)[
  The diagram shows a cross-section through a leaf. Label each part.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      rect((-4, 1.6), (4, 2.0), fill: luma(90%))
      rect((-4, 0.6), (4, 1.6), fill: rgb("#8fd16b"))
      rect((-4, -0.6), (4, 0.6), fill: rgb("#c5ebA0"))
      rect((-4, -1.0), (4, -0.6), fill: luma(90%))
      circle((1.5, 0), radius: 0.35, fill: rgb("#f4d35e"))
      ellipse((-1.5, -0.8), (-1.2, -0.8), fill: white)
      line((-5, 1.8), (-4.1, 1.8))
      line((-5, 1.1), (-4.1, 1.1))
      line((-5, -0.8), (-1.8, -0.8))
      line((5, 0), (1.9, 0))
      content((-5.4, 1.8), [A], anchor: "east")
      content((-5.4, 1.1), [B], anchor: "east")
      content((-5.4, -0.8), [C], anchor: "east")
      content((5.4, 0), [D], anchor: "west")
    })
  ]

  + A: #blank(width: 9em, answer: [upper epidermis])
  + B: #blank(width: 9em, answer: [palisade mesophyll])
  + C: #blank(width: 9em, answer: [stoma])
  + D: #blank(width: 9em, answer: [vascular bundle])
]

#question(points: 3)[
  Explain why most photosynthesis happens in the upper part of the leaf. Use the words _palisade_ and _chlorophyll_ in your answer.
  #answer-lines(count: 3, answer: [The palisade layer is packed with chloroplasts containing chlorophyll, and it sits close to the upper surface, so it receives the most light.])
]