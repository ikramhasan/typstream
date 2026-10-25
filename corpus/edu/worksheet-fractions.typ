#set page(paper: "a4", margin: (x: 2cm, y: 2.2cm))
#set text(size: 11pt)
#set par(justify: true)

#let answer-line(width: 4cm) = box(width: width, stroke: (bottom: 0.5pt), height: 1em)

#align(center)[
  #text(size: 18pt, weight: "bold")[Adding and Subtracting Fractions]

  Grade 5 · Mathematics · Worksheet 3
]

#grid(
  columns: (1fr, 1fr),
  gutter: 1em,
  [Name: #answer-line(width: 6cm)], [Date: #answer-line()],
)

#line(length: 100%, stroke: 0.6pt)

== Remember

To add or subtract fractions with *different denominators*, first find a common denominator:

$ a/b + c/d = (a d + c b)/(b d) $

Always write your answer in *simplest form*. For example, $2/4 = 1/2$.

== Part A: Same denominators

Solve each problem. Show your work.

#enum(
  numbering: "1.",
  [$1/5 + 2/5 =$ #answer-line()],
  [$3/8 + 4/8 =$ #answer-line()],
  [$7/10 - 3/10 =$ #answer-line()],
  [$5/6 - 1/6 =$ #answer-line()],
)

== Part B: Different denominators

#columns(2)[
  + $1/2 + 1/3 =$ #answer-line(width: 3cm)
  + $2/3 + 1/6 =$ #answer-line(width: 3cm)
  + $3/4 - 1/8 =$ #answer-line(width: 3cm)
  + $5/6 - 1/4 =$ #answer-line(width: 3cm)

  #colbreak()

  5. $2/5 + 1/4 =$ #answer-line(width: 3cm)
  + $7/12 - 1/3 =$ #answer-line(width: 3cm)
  + $1 1/2 + 2/3 =$ #answer-line(width: 3cm)
  + $3 - 5/7 =$ #answer-line(width: 3cm)
]

== Part C: Word problems

+ Maya ate $1/4$ of a pizza and her brother ate $3/8$ of the same pizza. What fraction of the pizza did they eat altogether?

  #v(2.5em)

+ A ribbon is $5/6$ m long. Leo cuts off $1/3$ m. How long is the ribbon now?

  #v(2.5em)

+ *Challenge:* Is $2/3 + 3/4$ greater than or less than $1 1/2$? Explain how you know.

  #v(3em)

#align(right)[#text(fill: gray)[Total: \_\_\_ / 15 points]]
