#set page(paper: "us-letter", margin: 2cm)
#set text(size: 11pt)
#set par(leading: 0.7em)

#let blank = box(width: 6em, height: 1em, stroke: (bottom: 0.6pt))

#align(center)[
  #text(size: 20pt, weight: "bold")[Photosynthesis]
  #v(0.2em)
  Grade 7 Science Worksheet
]

#v(0.5em)
Name: #box(width: 8cm, stroke: (bottom: 0.6pt), height: 1em) #h(1fr) Date: #box(width: 3cm, stroke: (bottom: 0.6pt), height: 1em)

#v(0.5em)

== Part A: Fill in the Blank

Use the words in the word bank to complete each sentence. Each word is used once.

#align(center)[
  #box(stroke: 0.8pt, inset: 8pt, radius: 4pt)[
    *Word Bank:* #h(0.5em) chlorophyll #sym.bullet carbon dioxide #sym.bullet glucose #sym.bullet oxygen #sym.bullet sunlight #sym.bullet stomata #sym.bullet water
  ]
]

#v(0.5em)

+ Photosynthesis is the process plants use to turn light energy into chemical energy stored in #blank.
+ The green pigment that captures light energy in leaves is called #blank.
+ Plants take in #blank from the air through tiny openings called #blank.
+ The roots absorb #blank from the soil and send it up to the leaves.
+ The energy needed for photosynthesis comes from #blank.
+ During photosynthesis, plants release #blank into the air as a waste product.

The chemical equation for photosynthesis is:

$ 6 "CO"_2 + 6 "H"_2"O" arrow.r "C"_6"H"_(12)"O"_6 + 6 "O"_2 $

#v(0.5em)

== Part B: Multiple Choice

Circle the letter of the best answer.

+ Where in the plant cell does photosynthesis take place?\
  A. Nucleus #h(1.5em) B. Mitochondria #h(1.5em) C. Chloroplast #h(1.5em) D. Cell wall

+ Which of the following is a *reactant* (something needed) for photosynthesis?\
  A. Oxygen #h(1.5em) B. Carbon dioxide #h(1.5em) C. Glucose #h(1.5em) D. Nitrogen

+ Which of the following is a *product* of photosynthesis?\
  A. Water #h(1.5em) B. Sunlight #h(1.5em) C. Carbon dioxide #h(1.5em) D. Glucose

+ Why are most leaves flat and thin?\
  A. To store more water\
  B. To catch more sunlight and let gases move in and out easily\
  C. To protect the plant from animals\
  D. To make the stem stronger

+ What would most likely happen to a plant kept in a dark closet for two weeks?\
  A. It would grow faster\
  B. It would make more oxygen\
  C. It would make less glucose and begin to turn yellow\
  D. Nothing would change

+ Animals depend on photosynthesis because it provides\
  A. oxygen to breathe and food energy\
  B. only water\
  C. only carbon dioxide\
  D. heat for the Earth

#v(0.5em)

== Part C: Label the Leaf

The diagram below shows a cross-section of a leaf (a very thin slice, viewed under a microscope). Write the name of each numbered part on the matching line. Use the word bank.

#align(center)[
  #box(stroke: 0.8pt, inset: 6pt, radius: 4pt)[
    upper epidermis #sym.bullet palisade mesophyll #sym.bullet spongy mesophyll #sym.bullet vein (xylem and phloem) #sym.bullet stoma
  ]
]

#v(0.5em)

#align(center)[
  #box(width: 270pt, height: 200pt)[
    // Sunlight label
    #place(left + top, dx: 60pt, dy: 0pt)[#text(size: 9pt)[#emph[Sunlight] #sym.arrow.b #sym.arrow.b #sym.arrow.b]]

    // Layers
    #place(left + top, dx: 0pt, dy: 20pt, rect(width: 200pt, height: 25pt, fill: rgb("#d5ecb0"), stroke: 0.8pt))
    #place(left + top, dx: 0pt, dy: 45pt, rect(width: 200pt, height: 50pt, fill: rgb("#6fbf5a"), stroke: 0.8pt))
    #place(left + top, dx: 0pt, dy: 95pt, rect(width: 200pt, height: 55pt, fill: rgb("#a9dc8e"), stroke: 0.8pt))
    #place(left + top, dx: 0pt, dy: 150pt, rect(width: 200pt, height: 25pt, fill: rgb("#d5ecb0"), stroke: 0.8pt))

    // Palisade cells
    #for i in range(0, 10) {
      place(left + top, dx: 3pt + i * 20pt, dy: 48pt, rect(width: 14pt, height: 44pt, radius: 5pt, fill: rgb("#3f9a3a"), stroke: 0.5pt))
    }

    // Spongy cells
    #for i in range(0, 5) {
      place(left + top, dx: 8pt + i * 38pt, dy: 100pt, ellipse(width: 26pt, height: 18pt, fill: rgb("#7cc563"), stroke: 0.5pt))
      place(left + top, dx: 24pt + i * 38pt, dy: 124pt, ellipse(width: 26pt, height: 18pt, fill: rgb("#7cc563"), stroke: 0.5pt))
    }

    // Vein
    #place(left + top, dx: 140pt, dy: 112pt, circle(radius: 10pt, fill: rgb("#f4e3a1"), stroke: 1pt))
    #place(left + top, dx: 146pt, dy: 118pt, circle(radius: 4pt, fill: rgb("#c9863a"), stroke: 0.5pt))

    // Stoma (opening with two guard cells)
    #place(left + top, dx: 80pt, dy: 150pt, rect(width: 24pt, height: 26pt, fill: white, stroke: none))
    #place(left + top, dx: 70pt, dy: 152pt, ellipse(width: 14pt, height: 22pt, fill: rgb("#2f7d32"), stroke: 0.8pt))
    #place(left + top, dx: 100pt, dy: 152pt, ellipse(width: 14pt, height: 22pt, fill: rgb("#2f7d32"), stroke: 0.8pt))

    // Pointer lines
    #place(left + top, dx: 170pt, dy: 32pt, line(length: 55pt, stroke: 0.8pt))
    #place(left + top, dx: 170pt, dy: 70pt, line(length: 55pt, stroke: 0.8pt))
    #place(left + top, dx: 160pt, dy: 122pt, line(length: 65pt, stroke: 0.8pt))
    #place(left + top, dx: 180pt, dy: 140pt, line(length: 45pt, stroke: 0.8pt))
    #place(left + top, dx: 92pt, dy: 163pt, line(length: 133pt, stroke: 0.8pt))

    // Number tags
    #place(left + top, dx: 230pt, dy: 24pt, circle(radius: 8pt, inset: 0pt, stroke: 0.8pt, fill: white)[#align(center + horizon)[1]])
    #place(left + top, dx: 230pt, dy: 62pt, circle(radius: 8pt, inset: 0pt, stroke: 0.8pt, fill: white)[#align(center + horizon)[2]])
    #place(left + top, dx: 230pt, dy: 114pt, circle(radius: 8pt, inset: 0pt, stroke: 0.8pt, fill: white)[#align(center + horizon)[3]])
    #place(left + top, dx: 230pt, dy: 132pt, circle(radius: 8pt, inset: 0pt, stroke: 0.8pt, fill: white)[#align(center + horizon)[4]])
    #place(left + top, dx: 230pt, dy: 155pt, circle(radius: 8pt, inset: 0pt, stroke: 0.8pt, fill: white)[#align(center + horizon)[5]])

    // Bottom note
    #place(left + top, dx: 40pt, dy: 182pt)[#text(size: 9pt)[#emph[Leaf cross-section (not to scale)]]]
  ]
]

#v(0.5em)

#grid(
  columns: (auto, 1fr),
  row-gutter: 1.1em,
  column-gutter: 0.6em,
  [*1.*], line(length: 100%),
  [*2.*], line(length: 100%),
  [*3.*], line(length: 100%),
  [*4.*], line(length: 100%),
  [*5.*], line(length: 100%),
)

#v(1em)

*Bonus:* In one or two sentences, explain why the palisade mesophyll layer is located near the top of the leaf.

#v(1.5em)
#line(length: 100%)
#v(1.5em)
#line(length: 100%)