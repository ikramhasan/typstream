#set page(paper: "us-letter", margin: 1.5cm, flipped: true)
#set text(size: 10pt)

#let n = 12
#let hidden = ((2, 7), (3, 9), (4, 4), (5, 11), (6, 8), (7, 7), (8, 3), (9, 12), (11, 6), (12, 9))

#align(center)[
  #text(16pt, weight: "bold")[Times Tables Grid] \
  Fill in the missing products. The shaded row and column are the factors.
]

#table(
  columns: (n + 1) * (1fr,),
  rows: 1.6em,
  align: center + horizon,
  stroke: 0.4pt + luma(150),
  fill: (x, y) => if x == 0 or y == 0 { rgb("#fff3cd") },
  [*×*],
  ..range(1, n + 1).map(c => [*#c*]),
  ..for r in range(1, n + 1) {
    ([*#r*],)
    for c in range(1, n + 1) {
      if (r, c) in hidden { ([],) } else { ([#(r * c)],) }
    }
  },
)

#v(1em)

#grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 1em,
  [*Quick check 1* \ $7 times 8 = $ ____], [*Quick check 2* \ $9 times 6 = $ ____], [*Quick check 3* \ $12 times 12 = $ ____],
)
