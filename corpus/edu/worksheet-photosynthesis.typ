#set page(margin: (x: 2.2cm, y: 2cm), numbering: "1")
#set text(size: 11pt)
#show heading.where(level: 1): set text(fill: rgb("#2e7d32"))

#let blank(n) = box(width: n * 1em, stroke: (bottom: 0.5pt + black))
#let callout(title, body) = block(
  fill: rgb("#e8f5e9"),
  stroke: (left: 3pt + rgb("#2e7d32")),
  inset: 10pt,
  radius: 2pt,
  width: 100%,
)[*#title* \ #body]

= Photosynthesis: How Plants Make Food

#callout("Key idea")[
  Plants use light energy to turn carbon dioxide and water into glucose and oxygen.
  This happens mostly in the *chloroplasts* of leaf cells.
]

The overall equation is:

$ 6 "CO"_2 + 6 "H"_2"O" stretch(->)^"light" "C"_6"H"_12"O"_6 + 6 "O"_2 $

== 1. Fill in the blanks

Use the word bank: _chlorophyll, glucose, stomata, oxygen, sunlight, roots_.

+ Plants absorb water through their #blank(6).
+ Carbon dioxide enters the leaf through tiny pores called #blank(6).
+ The green pigment that captures light is #blank(7).
+ The sugar made during photosynthesis is #blank(6).
+ The gas released as a by-product is #blank(6).

== 2. Inputs and outputs

Complete the table.

#table(
  columns: (1fr, 1fr, 1fr),
  align: (left, center, center),
  fill: (x, y) => if y == 0 { rgb("#c8e6c9") },
  table.header[*Substance*][*Input or output?*][*Where does it come from / go?*],
  [Water], [], [],
  [Carbon dioxide], [], [],
  [Glucose], [], [],
  [Oxygen], [], [],
  [Light energy], [], [],
)

== 3. Experiment

Two identical plants are kept for one week: plant A on a sunny windowsill and plant B in a dark cupboard.

/ Prediction: Which plant will be healthier after one week? #blank(12)
/ Reason: #blank(20)
/ Variable changed: #blank(12)
/ Variables kept the same: #blank(16)

== 4. Explain

In 3–4 sentences, explain why photosynthesis is important for animals as well as plants.

#for _ in range(4) [
  #line(length: 100%, stroke: 0.4pt + gray)
  #v(0.8em)
]
