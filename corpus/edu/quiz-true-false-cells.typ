#set page(margin: 2cm)
#set text(size: 11pt)

#let statements = (
  ("All living things are made of cells.", true),
  ("Plant cells have a cell wall but animal cells do not.", true),
  ("The nucleus is where photosynthesis takes place.", false),
  ("Mitochondria release energy from food during respiration.", true),
  ("Bacteria cells have a nucleus.", false),
  ("Cells can only be seen with an electron microscope.", false),
  ("Red blood cells carry oxygen around the body.", true),
  ("The cell membrane controls what enters and leaves the cell.", true),
)

#let key = false

= Cells: True or False?

Write *T* if the statement is true and *F* if it is false. If a statement is false, correct it on the line below.

#table(
  columns: (2em, 1fr, 3em),
  inset: 8pt,
  stroke: (x, y) => (bottom: 0.5pt + luma(180)),
  table.header([*\#*], [*Statement*], [*T / F*]),
  ..statements
    .enumerate(start: 1)
    .map(((i, s)) => (
      [#i],
      [#s.at(0) \ #text(fill: luma(160))[#box(width: 100%, repeat[.])]],
      if key { if s.at(1) [T] else [F] } else [],
    ))
    .flatten(),
)

#v(1em)

== Label the cell

#figure(
  rect(width: 70%, height: 5cm, radius: 40%, stroke: 1pt)[
    #align(center + horizon)[
      #circle(radius: 0.9cm, fill: luma(220))[#align(center + horizon)[1]]
    ]
  ],
  caption: [An animal cell. Label the nucleus (1), the cytoplasm and the cell membrane.],
) <fig-cell>

Using @fig-cell, explain one difference between this cell and a plant cell.

#line(length: 100%, stroke: 0.4pt)
#v(0.6em)
#line(length: 100%, stroke: 0.4pt)
