#set page(margin: 2cm)
#set text(size: 11pt)

#let shape-card(drawing, label, prompt) = box(
  width: 100%,
  stroke: 0.5pt + luma(180),
  radius: 4pt,
  inset: 10pt,
)[
  #align(center, box(height: 3.2cm, align(horizon, drawing)))
  *#label* \
  #prompt \
  Area $=$ #box(width: 2.5cm, stroke: (bottom: 0.4pt))
]

= Area of 2D Shapes

#table(
  columns: (auto, 1fr),
  stroke: none,
  inset: 4pt,
  [Rectangle], [$A = l times w$],
  [Triangle], [$A = 1/2 b h$],
  [Parallelogram], [$A = b h$],
  [Trapezium], [$A = 1/2 (a + b) h$],
  [Circle], [$A = pi r^2$],
)

#grid(
  columns: (1fr, 1fr),
  gutter: 12pt,
  shape-card(
    rect(width: 3.5cm, height: 2cm, fill: rgb("#e3f2fd"), stroke: 1pt)[
      #place(bottom + center, dy: 1.2em)[7 cm]
      #place(right + horizon, dx: 3.4em)[4 cm]
    ],
    [A. Rectangle],
    [Length 7 cm, width 4 cm.],
  ),
  shape-card(
    polygon(fill: rgb("#fce4ec"), stroke: 1pt, (0cm, 2.5cm), (4cm, 2.5cm), (1.5cm, 0cm)),
    [B. Triangle],
    [Base 8 cm, height 5 cm.],
  ),
  shape-card(
    polygon(fill: rgb("#f1f8e9"), stroke: 1pt, (0cm, 2.2cm), (3.2cm, 2.2cm), (4.2cm, 0cm), (1cm, 0cm)),
    [C. Parallelogram],
    [Base 9 cm, perpendicular height 4 cm.],
  ),
  shape-card(
    polygon(fill: rgb("#fff8e1"), stroke: 1pt, (0cm, 2.4cm), (4.4cm, 2.4cm), (3.4cm, 0cm), (1cm, 0cm)),
    [D. Trapezium],
    [Parallel sides 6 cm and 10 cm, height 5 cm.],
  ),
  shape-card(
    {
      circle(radius: 1.3cm, fill: rgb("#ede7f6"), stroke: 1pt)
      place(center + horizon, dx: 0.65cm, line(length: 1.3cm, stroke: (dash: "dashed")))
    },
    [E. Circle],
    [Radius 3 cm. Use $pi approx 3.14$.],
  ),
  shape-card(
    curve(
      fill: rgb("#e0f2f1"),
      stroke: 1pt,
      curve.move((0cm, 2.5cm)),
      curve.line((3cm, 2.5cm)),
      curve.line((3cm, 1cm)),
      curve.line((1.5cm, 1cm)),
      curve.line((1.5cm, 0cm)),
      curve.line((0cm, 0cm)),
      curve.close(),
    ),
    [F. Compound shape],
    [Split it into two rectangles first.],
  ),
)

== Challenge

A circular pond of radius 2 m sits in a rectangular garden that measures 10 m by 6 m.
What area of the garden is *not* covered by the pond? Give your answer to 1 decimal place.

$ A_"garden" - A_"pond" = 10 times 6 - pi (2)^2 approx #calc.round(60 - calc.pi * 4, digits: 1) "m"^2 $
