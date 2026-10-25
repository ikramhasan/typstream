#set page(margin: 2cm, header: align(right, text(8pt, fill: gray)[English · Unit 4 · Persuasive writing]))
#set text(size: 11pt)
#set heading(numbering: "1.1")

#let stage(name, minutes, body) = block(
  width: 100%,
  stroke: 0.5pt + luma(200),
  radius: 4pt,
  inset: 10pt,
  breakable: false,
)[
  #text(weight: "bold")[#name] #h(1fr) #box(fill: luma(235), inset: 3pt, radius: 2pt)[#minutes min]
  #v(0.3em)
  #body
]

= Persuasive Writing: Should Homework Be Banned?

*Year group:* 6 #h(2em) *Lesson:* 3 of 5 #h(2em) *Length:* 60 minutes

== Objectives

- Identify persuasive techniques (rhetorical questions, emotive language, the rule of three, statistics).
- Plan a persuasive paragraph with a clear point, evidence and explanation (PEE).

== Key vocabulary

#grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 6pt,
  ..("argument", "counter-argument", "rhetorical question", "emotive language", "evidence", "conclusion").map(w => box(
    width: 100%,
    inset: 6pt,
    fill: rgb("#fdf2e9"),
    radius: 3pt,
  )[#w]),
)

== Lesson stages

#stage("Starter", 10)[
  Show two adverts side by side. Students list every word or trick that makes them want to buy the product.
]

#stage("Modelling", 15)[
  Read the model text "Homework: a waste of childhood?" aloud. Highlight techniques in different colours:
  - #highlight(fill: yellow)[rhetorical questions]
  - #highlight(fill: rgb("#b3e5fc"))[statistics]
  - #highlight(fill: rgb("#f8bbd0"))[emotive language]
]

#stage("Planning", 15)[
  Students choose a side and complete the planning frame:

  #table(
    columns: (auto, 1fr),
    [*Point*], [],
    [*Evidence*], [],
    [*Explanation*], [],
    [*Technique used*], [],
  )
]

#stage("Writing", 15)[
  Write one persuasive paragraph. Challenge: include a counter-argument and rebut it.
]

#stage("Plenary", 5)[
  Two volunteers read their paragraphs. The class identifies the techniques ("I heard a rule of three!").
]

== Assessment for learning

#quote(block: true, attribution: [Success criteria shared with students])[
  My paragraph makes one clear point, backs it up with evidence, explains why it matters,
  and uses at least two persuasive techniques.
]
