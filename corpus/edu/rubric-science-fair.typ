#set page(margin: 2cm)
#set text(size: 10pt)

#let check = box(width: 0.9em, height: 0.9em, stroke: 0.6pt, baseline: 0.1em)

= Science Fair Project — Scoring Guide

*Project title:* #box(width: 9cm, stroke: (bottom: 0.4pt)) #h(1fr) *Judge:* #box(width: 3cm, stroke: (bottom: 0.4pt))

#let section(title, weight, items) = {
  let rows = (table.cell(colspan: 4, fill: luma(225))[*#title* #h(1fr) weight × #weight],)
  for (i, item) in items.enumerate() {
    rows += ([#(i + 1)], [#item], [#check 0 #h(4pt) #check 1 #h(4pt) #check 2 #h(4pt) #check 3], [])
  }
  rows
}

#table(
  columns: (auto, 1fr, auto, 2.5cm),
  inset: 6pt,
  stroke: 0.5pt + luma(170),
  table.header([*\#*], [*Criterion*], [*Rating*], [*Notes*]),
  ..section("Scientific thought", 3, (
    "The question is clear, focused and testable.",
    "The hypothesis is based on research.",
    "Variables are identified and controlled.",
  )),
  ..section("Method and data", 2, (
    "Procedure is detailed enough to repeat.",
    "Enough trials were run (at least 3).",
    "Data are recorded in tables with units.",
    "Graphs are appropriate and labelled.",
  )),
  ..section("Conclusions", 2, (
    "Conclusion is supported by the data.",
    "Sources of error are discussed.",
    "Ideas for further investigation are given.",
  )),
  ..section("Presentation", 1, (
    "Display board is organised and readable.",
    "Student explains the project confidently.",
    "Student answers questions accurately.",
  )),
)

== Score calculation

$ "Score" = 3 S_"thought" + 2 S_"method" + 2 S_"conclusions" + S_"presentation" $

#let max = 3 * 9 + 2 * 12 + 2 * 9 + 9
Maximum possible score: *#max*.

#table(
  columns: (1fr, 1fr, 1fr, 1fr),
  align: center,
  [*Gold*], [*Silver*], [*Bronze*], [*Merit*],
  [≥ #calc.round(max * 0.85)], [≥ #calc.round(max * 0.7)], [≥ #calc.round(max * 0.55)], [< #calc.round(max * 0.55)],
)
