= Area and Perimeter of Rectangles and Triangles

Name: #line(length: 6cm) Date: #line(length: 3cm)

== Key Formulas

- Rectangle area: $A = l times w$
- Rectangle perimeter: $P = 2l + 2w$
- Triangle area: $A = 1/2 times b times h$, where $b$ is the base and $h$ is the perpendicular height

Area is measured in square centimetres (cm²). Perimeter is measured in centimetres (cm).

== Part A: Rectangles

#let rectfig(w, h, tw, th) = box(width: w + 40pt, height: h + 30pt)[
  #place(top + left, dx: 30pt, dy: 20pt, rect(width: w, height: h, stroke: 1pt))
  #place(top + left, dx: 30pt, dy: 2pt, box(width: w, align(center)[#tw]))
  #place(top + left, dx: 0pt, dy: 20pt + h / 2 - 6pt, th)
]

+ Find the area and perimeter of this rectangle.

  #align(center, rectfig(96pt, 60pt, [8 cm], [5 cm]))

  Area: #v(1.5em)
  Perimeter: #v(1.5em)

+ Find the area and perimeter of this rectangle.

  #align(center, rectfig(108pt, 48pt, [9 cm], [4 cm]))

  Area: #v(1.5em)
  Perimeter: #v(1.5em)

+ A rectangle has an area of 24 cm². Its width is 6 cm. Find its length and its perimeter.

  Length: #line(length: 5cm)

  Perimeter: #line(length: 5cm)

== Part B: Triangles

#let trifig(b, h, a, tb, th) = box(width: b + 60pt, height: h + 40pt)[
  #place(top + left, dx: 30pt, dy: 20pt, polygon(fill: none, stroke: 1pt, (0pt, h), (b, h), (a, 0pt)))
  #place(top + left, dx: 30pt + a, dy: 20pt, line(start: (0pt, 0pt), end: (0pt, h), stroke: (dash: "dashed", paint: gray)))
  #place(top + left, dx: 30pt, dy: 20pt + h + 6pt, box(width: b, align(center)[#tb]))
  #place(top + left, dx: 30pt + a + 4pt, dy: 20pt + h / 2 - 6pt, th)
]

+ Find the area of this triangle. The dashed line shows the height.

  #align(center, trifig(120pt, 72pt, 48pt, [10 cm], [6 cm]))

  Area: #v(1.5em)

+ Find the area of this triangle. The dashed line shows the height.

  #align(center, trifig(84pt, 60pt, 24pt, [7 cm], [5 cm]))

  Area: #v(1.5em)

+ A triangle has a base of 9 cm and a height of 4 cm. Find its area. Then explain why a rectangle with the same base and height has an area twice as large.

  #v(3em)

+ A triangle has sides of 5 cm, 5 cm and 6 cm. Find its perimeter.

  #v(2em)

== Part C: Word Problems

+ A rectangular garden is 12 m long and 7 m wide. Fencing costs \$4 per metre. Find the perimeter of the garden and the total cost of fencing all the way around it.

  #v(3em)

+ Mia paints a triangular sign with a base of 80 cm and a height of 50 cm. One tin of paint covers 1 m² (10 000 cm²). Does one tin cover the sign? Show your working.

  #v(3em)

+ Write your own rectangle with an area of 30 cm² and a perimeter different from 22 cm. Draw it on the back of this sheet and label all sides.

  #v(2em)

== Teacher Answer Key

+ Area 40 cm²; perimeter 26 cm.
+ Area 36 cm²; perimeter 26 cm.
+ Length 4 cm; perimeter 20 cm.
+ Area 30 cm².
+ Area 17.5 cm².
+ Area 18 cm².
+ Triangle with base 9 cm and height 4 cm has area 18 cm²; the rectangle has area 36 cm², so the triangle is half of it.
+ Perimeter 16 cm.
+ Perimeter 38 m; cost \$152.
+ Area 2000 cm² (base 80 cm × height 50 cm ÷ 2); one tin (10 000 cm²) is enough.
+ Answers vary; for example 5 cm by 6 cm has area 30 cm² and perimeter 22 cm, so students should pick different sides such as 3 cm by 10 cm (perimeter 26 cm).