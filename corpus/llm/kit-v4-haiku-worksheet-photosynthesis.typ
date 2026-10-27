#show: worksheet.with(title: [Photosynthesis], subject: [Science], grade: [Grade 7], info: ("name", "class", "date"))
#import "@preview/cetz:0.5.3"

#instructions[
  - Answer *all* questions.
  - Use the words in the word bank where needed.
]

#callout(kind: "remember")[
  Photosynthesis: #ce("6CO2 + 6H2O -> C6H12O6 + 6O2")
]

= Part A: Fill in the blanks

#question(points: 2)[
  Plants use #blank(width: 6em, answer: [sunlight]) to make food. The gas they take in from the air is
  #blank(width: 6em, answer: [carbon dioxide]).
]

#question(points: 2)[
  The green pigment that traps light is called #blank(width: 6em, answer: [chlorophyll]). It is found mainly in the
  #blank(width: 6em, answer: [chloroplasts]).
]

#question(points: 1)[
  The gas released as a by-product of photosynthesis is #blank(width: 6em, answer: [oxygen]).
]

= Part B: Multiple choice

#question(points: 1)[
  Which organelle is the site of photosynthesis?
  #mcq([Nucleus], [Mitochondrion], [Chloroplast], [Cell wall], answer: 3)
]

#question(points: 1)[
  Which condition is *not* needed for photosynthesis?
  #mcq([Light], [Water], [Carbon dioxide], [Oxygen gas], answer: 4)
]

#question(points: 1)[
  Which sugar is the main product of photosynthesis?
  #mcq([Glucose], [Starch], [Cellulose], [Protein], answer: 1)
]

= Part C: Label the diagram

#question(points: 4)[
  Label the parts of the leaf below (A to D) using the words: _stomata, chloroplasts, midrib, cuticle_.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      circle((0, 0), radius: (3, 1.6), stroke: 1pt)
      line((-3, 0), (3, 0), stroke: 0.8pt)
      line((-2.5, 0.8), (2.5, 0.8), stroke: (dash: "dashed", paint: gray))
      content((4.2, 1), [A])
      content((-4.2, -1), [B])
      content((0, -2.2), [C])
      content((-2.2, 1.8), [D])
      line((4, 1), (2, 0.4))
      line((-4, -1), (-2, -0.2))
      line((0, -2), (0, -1))
      line((-2, 1.6), (-1.2, 0.9))
    })
  ]

  A #blank(width: 7em, answer: [cuticle]) \
  B #blank(width: 7em, answer: [midrib]) \
  C #blank(width: 7em, answer: [stomata]) \
  D #blank(width: 7em, answer: [chloroplasts])
]

= Part D: Explain

#question(points: 3)[
  A student places a pondweed plant in sunlight and counts bubbles of gas released per minute. When she moves the lamp further away, fewer bubbles appear. Explain why.
  #answer-lines(count: 3, answer: [Less light reaches the plant, so the rate of photosynthesis falls and less oxygen is produced, so fewer bubbles are released.])
]

#answer-key()